/**
 * Tests for the extracted loop-orchestration command handlers.
 *
 * Each test builds a minimal `LoopCommandDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect } from "bun:test"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import type { ClaudeSessionState } from "./claude-session-state"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"
import {
  isLoopArmed,
  listLiveSchedules,
  clearClaudeSessionContext,
  deliverSubagentToMain,
  setupLoop,
  stopLoop,
} from "./claude-loop-commands"

import { makeDeps, makeStore } from "./test-helpers/loop-command-fakes"

// `orch` names two features in this repo. This module keeps the autonomous
// loop + subagent delivery handlers; the multi-task orchestration engine is
// retired (adr-20260802-retire-orchestration-core). Pinning the export shape
// is the machine-checkable statement of which of the two survives.
describe("module surface", () => {
  test("exports only the loop + delivery handlers", async () => {
    const mod = await import("./claude-loop-commands")
    expect(Object.keys(mod).sort()).toEqual([
      "MAX_CONSECUTIVE_LOOP_FAILURES",
      "clearClaudeSessionContext",
      "deliverSubagentToMain",
      // Exported for `loop-wake-recovery.ts`: the host backstop that disarms a
      // loop failing repeatedly is shared by the delivery and the failed-turn path.
      "disarmFailingLoop",
      "isLoopArmed",
      "listLiveSchedules",
      "setupLoop",
      "stopLoop",
      // Narrows LoopState → the slice kanna-mcp needs; the single adapter
      // between the read model and the MCP host, so both spawn paths agree.
      "toArmedLoopInfo",
    ])
  })
})

describe("isLoopArmed", () => {
  test("returns null when no events", () => {
    const deps = makeDeps()
    expect(isLoopArmed(deps, "chat-1")).toBeNull()
  })

  test("returns LoopState when loop_armed event is present", () => {
    const deps = makeDeps()
    const armEvent: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      subagentId: "agent-1",
      prompt: "Read PROGRESS.md",
    }
    deps.store.getAutoContinueEvents = () => [armEvent]
    const result = isLoopArmed(deps, "chat-1")
    expect(result).not.toBeNull()
    expect(result?.prompt).toBe("Read PROGRESS.md")
  })

  test("returns null after loop_disarmed event", () => {
    const deps = makeDeps()
    const now = Date.now()
    const events: AutoContinueEvent[] = [
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_armed",
        timestamp: now,
        chatId: "chat-1",
        scheduleId: "sched-1",
        subagentId: "agent-1",
        prompt: "Read PROGRESS.md",
      },
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_disarmed",
        timestamp: now + 1,
        chatId: "chat-1",
        scheduleId: "sched-2",
        reason: "goal_met",
      },
    ]
    deps.store.getAutoContinueEvents = () => events
    expect(isLoopArmed(deps, "chat-1")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listLiveSchedules
// ---------------------------------------------------------------------------

describe("listLiveSchedules", () => {
  test("returns empty array when no events", () => {
    const deps = makeDeps()
    expect(listLiveSchedules(deps, "chat-1")).toEqual([])
  })

  test("returns scheduleIds for proposed/scheduled events", () => {
    const deps = makeDeps()
    const now = Date.now() + 10_000
    const events: AutoContinueEvent[] = [
      {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: Date.now(),
        chatId: "chat-1",
        scheduleId: "sched-a",
        scheduledAt: now,
        tz: "system",
        source: "auto_setting",
        resetAt: now,
        detectedAt: Date.now(),
      },
    ]
    deps.store.getAutoContinueEvents = () => events
    const schedules = listLiveSchedules(deps, "chat-1")
    expect(schedules).toContain("sched-a")
  })
})

// ---------------------------------------------------------------------------
// clearClaudeSessionContext
// ---------------------------------------------------------------------------

describe("clearClaudeSessionContext", () => {
  test("sets session token to null", async () => {
    const store = makeStore()
    const deps = makeDeps({ store })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(store.sessionTokensSet.some((e) => e.chatId === "chat-1" && e.token === null)).toBe(true)
  })

  test("sets suppressSessionTokenPersist on live session when no active turn", async () => {
    const store = makeStore()
    const fakeSession = {
      chatId: "chat-1",
      suppressSessionTokenPersist: false,
      pendingPromptSeqs: [],
      selfWakeActive: false,
      backgroundTasks: new Map(),
      backgroundTasksLevelSourced: false,
      backgroundTaskDeadlineAt: 0,
    } as unknown as ClaudeSessionState
    const claudeSessions = new Map<string, ClaudeSessionState>([["chat-1", fakeSession]])
    const activeTurns = new Map<string, unknown>() // no active turn

    let closed = false
    const deps = makeDeps({
      store,
      claudeSessions,
      activeTurns,
      closeClaudeSession: () => {
        closed = true
      },
    })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(fakeSession.suppressSessionTokenPersist).toBe(true)
    expect(closed).toBe(true)
  })

  test("does not close session when active turn exists", async () => {
    const store = makeStore()
    const fakeSession = {
      chatId: "chat-1",
      suppressSessionTokenPersist: false,
      pendingPromptSeqs: [],
      selfWakeActive: false,
      backgroundTasks: new Map(),
      backgroundTasksLevelSourced: false,
      backgroundTaskDeadlineAt: 0,
    } as unknown as ClaudeSessionState
    const claudeSessions = new Map<string, ClaudeSessionState>([["chat-1", fakeSession]])
    const activeTurns = new Map<string, unknown>([["chat-1", {}]])

    let closed = false
    const deps = makeDeps({
      store,
      claudeSessions,
      activeTurns,
      closeClaudeSession: () => {
        closed = true
      },
    })
    await clearClaudeSessionContext(deps, "chat-1")
    expect(fakeSession.suppressSessionTokenPersist).toBe(true)
    expect(closed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// setupLoop — which tree the loop arms in
// ---------------------------------------------------------------------------

/**
 * `board-start-work.ts` gives EVERY card-started chat a primary stack binding
 * pointing at a fresh worktree, so "the project's registered path" and "the
 * tree this chat edits" are routinely different directories. Arming against
 * the former ran the oracle and wrote the tracking-file skeleton in the main
 * checkout while the agent worked in the worktree.
 */
describe("setupLoop — arms in the chat's own tree", () => {
  const validInput = {
    goal: "eslint --max-warnings=0 passes",
    verifyCommand: "bun run lint",
    subagentId: "sub-1",
  }

  function depsForChat(chat: { id: string; projectId: string; stackBindings?: unknown }) {
    const store = makeStore()
    store.chats.set(chat.id, chat as never)
    const verifyCalls: { cwd: string }[] = []
    const ensured: { absPath: string }[] = []
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      getSubagents: () => [{ id: "sub-1", name: "Worker", triggerMode: "auto" } as never],
      // The shared fake's default closes over its OWN store, so an injected
      // store never sees the events. Capture them here instead.
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
        store.events.push(event)
      },
      runVerifyCommand: async (args) => {
        verifyCalls.push({ cwd: args.cwd })
        return { exitCode: 1, output: "not done", timedOut: false, durationMs: 1 }
      },
      ensureTrackingFile: async (args) => {
        ensured.push({ absPath: args.absPath })
        return { created: true, reconciled: false, actions: [], absPath: args.absPath }
      },
    })
    return { deps, store, emitted, verifyCalls, ensured }
  }

  const worktreeChat = {
    id: "chat-1",
    projectId: "proj-1",
    stackBindings: [
      { projectId: "proj-1", worktreePath: "/repo/.worktrees/feat", role: "primary" },
    ],
  }

  test("a chat bound to a worktree arms there, not in the project checkout", async () => {
    const { deps, emitted, verifyCalls } = depsForChat(worktreeChat)
    const result = await setupLoop(deps, { chatId: "chat-1", input: validInput })

    expect(result.ok).toBe(true)
    const armed = emitted.find((e) => e.kind === "loop_armed")
    expect(armed).toBeDefined()
    expect((armed as { workdirAbs?: string }).workdirAbs).toBe("/repo/.worktrees/feat")
    // The arm-time oracle must run where the agent works, or it grades the
    // wrong tree and the already-green refusal fires on the wrong evidence.
    expect(verifyCalls).toEqual([{ cwd: "/repo/.worktrees/feat" }])
  })

  test("the tracking-file skeleton is written under the worktree", async () => {
    const { deps, ensured } = depsForChat(worktreeChat)
    await setupLoop(deps, { chatId: "chat-1", input: validInput })
    expect(ensured).toEqual([{ absPath: "/repo/.worktrees/feat/PROGRESS.md" }])
  })

  test("a solo chat with no bindings is unchanged", async () => {
    const { deps, emitted, verifyCalls, ensured } = depsForChat({ id: "chat-1", projectId: "proj-1" })
    const result = await setupLoop(deps, { chatId: "chat-1", input: validInput })

    expect(result.ok).toBe(true)
    const armed = emitted.find((e) => e.kind === "loop_armed")
    expect((armed as { workdirAbs?: string }).workdirAbs).toBe("/repo")
    expect(verifyCalls).toEqual([{ cwd: "/repo" }])
    expect(ensured).toEqual([{ absPath: "/repo/PROGRESS.md" }])
  })

  // The same-repo guard still compares against the PROJECT path — that is the
  // repository identity check, and widening it to the chat cwd would let a
  // loop be pointed at any directory a binding happens to name.
  test("an explicit workdir outside the repo is still refused", async () => {
    const { deps } = depsForChat(worktreeChat)
    deps.isWorktreeOfSameRepo = async () => false
    const result = await setupLoop(deps, {
      chatId: "chat-1",
      input: { ...validInput, workdir: "/somewhere/else" },
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors[0]).toContain("not this project's checkout")
  })

  // The chat's own cwd is host-derived (board-start-work created the worktree),
  // so it needs no git round-trip. A MODEL-supplied workdir is not trusted and
  // is still checked against the project checkout — the repository identity.
  test("the chat's own cwd is trusted without a git round-trip", async () => {
    const { deps } = depsForChat(worktreeChat)
    const asked: { projectCwd: string; workdir: string }[] = []
    deps.isWorktreeOfSameRepo = async (projectCwd, workdir) => {
      asked.push({ projectCwd, workdir })
      return true
    }
    await setupLoop(deps, { chatId: "chat-1", input: validInput })
    expect(asked).toEqual([])
  })

  test("an explicit workdir is checked against the project checkout", async () => {
    const { deps } = depsForChat(worktreeChat)
    const asked: { projectCwd: string; workdir: string }[] = []
    deps.isWorktreeOfSameRepo = async (projectCwd, workdir) => {
      asked.push({ projectCwd, workdir })
      return true
    }
    await setupLoop(deps, {
      chatId: "chat-1",
      input: { ...validInput, workdir: "/repo/.worktrees/other" },
    })
    expect(asked).toEqual([{ projectCwd: "/repo", workdir: "/repo/.worktrees/other" }])
  })
})

// ---------------------------------------------------------------------------
// stopLoop
// ---------------------------------------------------------------------------

describe("stopLoop", () => {
  test("is a no-op when loop is not armed", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
      },
    })
    await stopLoop(deps, "chat-1", "goal_met")
    expect(emitted).toHaveLength(0)
  })

  test("emits loop_disarmed when loop is armed", async () => {
    const emitted: AutoContinueEvent[] = []
    const armEvent: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      subagentId: "agent-1",
      prompt: "Read PROGRESS.md",
    }
    const deps = makeDeps({
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
      },
    })
    deps.store.getAutoContinueEvents = () => [armEvent]
    await stopLoop(deps, "chat-1", "goal_met")
    expect(emitted.some((e) => e.kind === "loop_disarmed")).toBe(true)
  })

  // A disarm used to write NOTHING to the transcript. `user_send` is the case
  // that matters: a takeover looked identical to the loop going quiet, so a
  // user who typed one word to nudge a stalled loop had no way to see they had
  // killed it.
  test("appends a visible card naming the plan and worktree", async () => {
    const store = makeStore()
    store.events.push(armedEvent())
    const deps = makeDeps({ store })
    await stopLoop(deps, "chat-1", "user_send")

    const card = store.messages.find((m) => m.entry.kind === "loop_disarmed")?.entry
    if (card?.kind !== "loop_disarmed") throw new Error("expected a loop_disarmed card")
    expect(card.reason).toBe("user_send")
    expect(card.resumable).toBe(true)
    expect(card.trackingFileRel).toBe("PROGRESS.md")
    expect(card.workdirAbs).toBe("/repo")
  })

  test("writes no card when there was no armed loop", async () => {
    const store = makeStore()
    const deps = makeDeps({ store })
    await stopLoop(deps, "chat-1", "user_send")
    expect(store.messages).toEqual([])
  })

  // A deleted chat has no transcript left to read the card in.
  test("writes no card when the chat is being deleted", async () => {
    const store = makeStore()
    store.events.push(armedEvent())
    const deps = makeDeps({ store })
    await stopLoop(deps, "chat-1", "chat_deleted")
    expect(store.messages.some((m) => m.entry.kind === "loop_disarmed")).toBe(false)
  })
})

function armedEvent(): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_armed",
    timestamp: 1,
    chatId: "chat-1",
    scheduleId: "la-1",
    subagentId: "sub-1",
    prompt: "ORCHESTRATOR loop prompt",
    verifyCommand: "sh verify.sh",
    workdirAbs: "/repo",
    trackingFileRel: "PROGRESS.md",
  }
}


function disarmedEvent(): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_disarmed",
    timestamp: 2,
    chatId: "chat-1",
    scheduleId: "ld-1",
    reason: "user_send",
  }
}

// The un-armed delivery prompt used to hardcode "Read PROGRESS.md if present".
// That is setup_loop's DEFAULT filename, so it names many different plans on a
// machine with several worktrees, and it resolved against the chat cwd rather
// than the loop's workdir — which sent a post-loop review to an unrelated
// FINISHED loop's plan in the wrong checkout.
describe("deliverSubagentToMain — naming the plan when no loop is armed", () => {
  async function deliver(events: AutoContinueEvent[]) {
    const store = makeStore()
    store.events.push(...events)
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
    })
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "done" }
    await deliverSubagentToMain(deps, "chat-1", "run-1", outcome)
    const accepted = emitted.find((e) => e.kind === "auto_continue_accepted")
    if (accepted?.kind !== "auto_continue_accepted") throw new Error("expected accepted event")
    return accepted.prompt ?? ""
  }

  test("names the disarmed loop's real plan as an absolute path", async () => {
    const prompt = await deliver([armedEvent(), disarmedEvent()])
    expect(prompt).toContain("/repo/PROGRESS.md")
    // The path must be absolute: the tracking-doc tools rebase to the chat cwd
    // once no loop is armed, so a bare filename resolves in the wrong checkout.
    expect(prompt).toContain("/repo")
  })

  test("names no file at all when the chat never ran a loop", async () => {
    const prompt = await deliver([])
    expect(prompt).not.toContain("PROGRESS.md")
    expect(prompt).toContain("context has been cleared")
  })
})

// ---------------------------------------------------------------------------
// deliverSubagentToMain
// ---------------------------------------------------------------------------

describe("deliverSubagentToMain", () => {
  test("no-ops when chat not found", async () => {
    const store = makeStore()
    store.chats.clear()
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => { emitted.push(event) },
    })
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "done" }
    await deliverSubagentToMain(deps, "unknown-chat", "run-1", outcome)
    expect(emitted).toHaveLength(0)
  })

  test("emits auto_continue_accepted on completed outcome", async () => {
    const emitted: AutoContinueEvent[] = []
    const store = makeStore()
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => {
        emitted.push(event)
        store.events.push(event)
      },
    })
    const outcome: BackgroundRunOutcome = { status: "completed", runId: "run-1", text: "done" }
    await deliverSubagentToMain(deps, "chat-1", "run-1", outcome)
    expect(emitted.some((e) => e.kind === "auto_continue_accepted")).toBe(true)
  })
})
