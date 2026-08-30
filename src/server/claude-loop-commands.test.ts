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
