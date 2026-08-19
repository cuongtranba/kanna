/**
 * Tests for the extracted loop-orchestration command handlers.
 *
 * Each test builds a minimal `LoopCommandDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect } from "bun:test"
import type { AutoContinueEvent } from "./auto-continue/events"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import type { TranscriptEntry } from "../shared/types"
import type { ClaudeSessionState } from "./claude-session-state"
import type { EnsureTrackingFileArgs, EnsureTrackingFileResult } from "./loop-template-io.adapter"
import type { BackgroundRunOutcome } from "./subagent-orchestrator"
import {
  isLoopArmed,
  listLiveSchedules,
  clearClaudeSessionContext,
  deliverSubagentToMain,
  recoverArmedLoopWakes,
  stopLoop,
  type LoopCommandDeps,
} from "./claude-loop-commands"

// ---------------------------------------------------------------------------
// Fake store builder
// ---------------------------------------------------------------------------

interface FakeStore {
  events: AutoContinueEvent[]
  messages: { chatId: string; entry: TranscriptEntry }[]
  chats: Map<string, { id: string; projectId: string }>
  projects: Map<string, { id: string; localPath: string }>
  sessionTokensSet: { chatId: string; provider: string; token: string | null }[]
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  getChat(chatId: string): { id: string; projectId: string } | null
  getProject(projectId: string): { id: string; localPath: string } | null
  setSessionTokenForProvider(chatId: string, provider: "claude", token: string | null): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  queuedByChat: Map<string, { id: string }[]>
  listAutoContinueChats(): string[]
  getQueuedMessages(chatId: string): readonly { id: string }[]
}

function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    events: [],
    messages: [],
    chats: new Map([["chat-1", { id: "chat-1", projectId: "proj-1" }]]),
    projects: new Map([["proj-1", { id: "proj-1", localPath: "/repo" }]]),
    sessionTokensSet: [],
    getAutoContinueEvents() {
      return store.events
    },
    getChat(chatId) {
      return store.chats.get(chatId) ?? null
    },
    getProject(projectId) {
      return store.projects.get(projectId) ?? null
    },
    async setSessionTokenForProvider(chatId, provider, token) {
      store.sessionTokensSet.push({ chatId, provider, token })
    },
    async appendMessage(chatId, entry) {
      store.messages.push({ chatId, entry })
    },
    queuedByChat: new Map(),
    listAutoContinueChats() {
      return [...store.chats.keys()]
    },
    getQueuedMessages(chatId) {
      return store.queuedByChat.get(chatId) ?? []
    },
    ...overrides,
  }
  return store
}

// ---------------------------------------------------------------------------
// Fake dep builder
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<LoopCommandDeps> = {}): LoopCommandDeps {
  const store = makeStore()
  const emittedEvents: AutoContinueEvent[] = []
  const closedSessions: string[] = []

  return {
    store,
    claudeSessions: new Map<string, ClaudeSessionState>(),
    activeTurns: new Map<string, unknown>(),
    startingTurns: new Map<string, unknown>(),
    getSubagents: () => [],
    getAppSettingsSnapshot: () => ({}),
    closeClaudeSession: (chatId) => {
      closedSessions.push(chatId)
    },
    emitAutoContinueEvent: async (event) => {
      emittedEvents.push(event)
      store.events.push(event)
    },
    ensureTrackingFile: async (_args: EnsureTrackingFileArgs): Promise<EnsureTrackingFileResult> => {
      return { created: true, reconciled: false, actions: [], absPath: _args.absPath }
    },
    ...overrides,
    // These MUST follow the spread: Partial<...> widens each to T|undefined,
    // so re-assigning with a ?? fallback keeps TS7 seeing a concrete function.
    isLoopArmed: overrides.isLoopArmed ?? ((_chatId: string) => null),
    isChatBusy: overrides.isChatBusy ?? ((_chatId: string) => false),
    inspectTrackingFile:
      overrides.inspectTrackingFile
      ?? (async () => ({ exists: false, content: null, gitTracked: false })),
    isWorktreeOfSameRepo: overrides.isWorktreeOfSameRepo ?? (async () => true),
    // Default oracle FAILS: an arming test should exercise the normal path,
    // and a passing oracle is now a refusal.
    runVerifyCommand:
      overrides.runVerifyCommand
      ?? (async () => ({ exitCode: 1, output: "not done", timedOut: false, durationMs: 1 })),
    readOracleScript: overrides.readOracleScript ?? (async () => null),
  }
}

// ---------------------------------------------------------------------------
// isLoopArmed
// ---------------------------------------------------------------------------

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
      "isLoopArmed",
      "listLiveSchedules",
      "recoverArmedLoopWakes",
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
})

function armedLoop(prompt = "ORCHESTRATOR loop prompt") {
  return {
    subagentId: "sub-1",
    prompt,
    armedAt: 1,
    consecutiveFailures: 0,
    verifyCommand: "sh verify.sh",
    workdirAbs: "/repo",
    trackingFileRel: "PROGRESS.md",
  }
}

describe("recoverArmedLoopWakes", () => {
  test("re-emits the wake for an armed chat left with nothing to wake it", async () => {
    const store = makeStore()
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => { emitted.push(event) },
      isLoopArmed: () => armedLoop(),
    })

    const recovered = await recoverArmedLoopWakes(deps)

    expect(recovered).toEqual(["chat-1"])
    expect(store.sessionTokensSet).toEqual([{ chatId: "chat-1", provider: "claude", token: null }])
    expect(store.messages.map((m) => m.entry.kind)).toEqual(["context_cleared"])
    expect(emitted).toHaveLength(1)
    const event = emitted[0]
    if (event.kind !== "auto_continue_accepted") throw new Error("expected accepted event")
    expect(event.source).toBe("subagent_background")
    expect(event.prompt).toContain("ORCHESTRATOR loop prompt")
    expect(event.prompt).toContain("restart")
  })

  test("does nothing for a chat with no armed loop", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({ emitAutoContinueEvent: async (e) => { emitted.push(e) } })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("leaves a chat whose queued message survived to the queue recovery", async () => {
    const store = makeStore()
    store.queuedByChat.set("chat-1", [{ id: "qm-1" }])
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("leaves a chat that is already busy", async () => {
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      emitAutoContinueEvent: async (e) => { emitted.push(e) },
      isLoopArmed: () => armedLoop(),
      isChatBusy: () => true,
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual([])
    expect(emitted).toEqual([])
  })

  test("one failing chat does not abort the rest", async () => {
    const store = makeStore()
    store.chats.set("chat-2", { id: "chat-2", projectId: "proj-1" })
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      store,
      emitAutoContinueEvent: async (event) => {
        if (event.chatId === "chat-1") throw new Error("append failed")
        emitted.push(event)
      },
      isLoopArmed: () => armedLoop(),
    })
    expect(await recoverArmedLoopWakes(deps)).toEqual(["chat-2"])
    expect(emitted.map((e) => e.chatId)).toEqual(["chat-2"])
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
