import { describe, it, expect, mock } from "bun:test"
import {
  getActiveStatuses,
  getBackgroundTasksByChatId,
  getWaitStartedAtByChatId,
  getPendingTool,
  getDrainingChatIds,
  getClaudeSessionStates,
  isClaudeSessionIdle,
  sweepIdleClaudeSessions,
  type SessionStateQueryDeps,
} from "./claude-session-state-queries"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<ClaudeSessionState>): ClaudeSessionState {
  return {
    id: "sess-1",
    chatId: "chat-1",
    session: {} as ClaudeSessionState["session"],
    localPath: "/tmp/test",
    additionalDirectories: [],
    model: "claude-opus-4-5",
    planMode: false,
    sessionToken: null,
    accountInfoLoaded: false,
    nextPromptSeq: 0,
    pendingPromptSeqs: [],
    activeTokenId: null,
    oauthKeyMasked: null,
    oauthLabel: null,
    openrouterKeyMasked: null,
    openrouterModel: null,
    lastUsedAt: Date.now(),
    backgroundTasks: new Map(),
    backgroundTaskDeadlineAt: 0,
    loopArmedAtSpawn: false,
    ...overrides,
  } as ClaudeSessionState
}

function makeActiveTurn(overrides?: Partial<ActiveTurn>): ActiveTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    turn: {} as ActiveTurn["turn"],
    model: "claude-opus-4-5",
    planMode: false,
    status: "running",
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    ...overrides,
  } as ActiveTurn
}

function makeStartingTurn(overrides?: Partial<StartingTurn>): StartingTurn {
  return {
    chatId: "chat-1",
    provider: "claude",
    startedAt: Date.now(),
    cancelRequested: false,
    ...overrides,
  }
}

function makeDeps(overrides?: Partial<SessionStateQueryDeps>): SessionStateQueryDeps {
  return {
    activeTurns: new Map(),
    startingTurns: new Map(),
    pendingTools: new PendingToolSlots(),
    claudeSessions: new Map(),
    drainingStreams: new Map(),
    isClaudeSdkProvider: mock(() => false),
    hasPendingBackgroundTask: mock(() => false),
    resolveClaudeIdleMs: mock(() => 600_000),
    resolveBackgroundTaskMaxMs: mock(() => 1_800_000),
    resolveBackgroundTaskMaxWakes: mock(() => 3),
    hasLiveWorkflow: mock(() => false),
    closeClaudeSession: mock(() => undefined),
    emitStateChange: mock(() => undefined),
    wakeBackgroundTaskSession: mock(() => undefined),
    notifyBackgroundTasksAbandoned: mock(() => undefined),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getActiveStatuses
// ---------------------------------------------------------------------------

describe("getActiveStatuses", () => {
  it("returns empty map when no active turns", () => {
    const deps = makeDeps()
    expect(getActiveStatuses(deps).size).toBe(0)
  })

  it("maps chatId → status for each active turn", () => {
    const deps = makeDeps({
      activeTurns: new Map([
        ["chat-1", makeActiveTurn({ chatId: "chat-1", status: "running" })],
        ["chat-2", makeActiveTurn({ chatId: "chat-2", status: "waiting_for_user" })],
      ]),
    })
    const result = getActiveStatuses(deps)
    expect(result.get("chat-1")).toBe("running")
    expect(result.get("chat-2")).toBe("waiting_for_user")
  })

  it("surfaces a self-wake session as running when it has no active turn", () => {
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", makeSession({ selfWakeActive: true })]]),
    })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("running")
  })

  it("an active turn's status wins over the self-wake flag", () => {
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", makeActiveTurn({ status: "waiting_for_user" })]]),
      claudeSessions: new Map([["chat-1", makeSession({ selfWakeActive: true })]]),
    })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("waiting_for_user")
  })

  it("idle sessions with no self-wake stay absent", () => {
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", makeSession({ selfWakeActive: false })]]),
    })
    expect(getActiveStatuses(deps).has("chat-1")).toBe(false)
  })

  it("surfaces a booting turn as starting", () => {
    const deps = makeDeps({
      startingTurns: new Map([["chat-1", makeStartingTurn()]]),
    })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("starting")
  })

  it("an active turn's status wins over a stale starting marker", () => {
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", makeActiveTurn({ status: "running" })]]),
      startingTurns: new Map([["chat-1", makeStartingTurn()]]),
    })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("running")
  })
})

// ---------------------------------------------------------------------------
// getBackgroundTasksByChatId
// ---------------------------------------------------------------------------

describe("getBackgroundTasksByChatId", () => {
  it("omits chats with no background tasks", () => {
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", makeSession()]]),
    })
    expect(getBackgroundTasksByChatId(deps).size).toBe(0)
  })

  it("maps task metadata to UI shape sorted oldest-first", () => {
    const session = makeSession({
      backgroundTasks: new Map([
        ["b2", { taskType: "local_agent", description: "Later task", startedAt: 200 }],
        ["a1", { taskType: "local_bash", description: "Earlier task", startedAt: 100 }],
      ]),
    })
    const deps = makeDeps({ claudeSessions: new Map([["chat-1", session]]) })
    const tasks = getBackgroundTasksByChatId(deps).get("chat-1")
    expect(tasks).toEqual([
      { id: "a1", taskType: "local_bash", description: "Earlier task", startedAt: 100 },
      { id: "b2", taskType: "local_agent", description: "Later task", startedAt: 200 },
    ])
  })
})

// ---------------------------------------------------------------------------
// getWaitStartedAtByChatId
// ---------------------------------------------------------------------------

describe("getWaitStartedAtByChatId", () => {
  it("returns empty map when no turns are waiting", () => {
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", makeActiveTurn({ waitStartedAt: null })]]),
    })
    expect(getWaitStartedAtByChatId(deps).size).toBe(0)
  })

  it("returns waitStartedAt only for turns with non-null value", () => {
    const ts = 12345
    const deps = makeDeps({
      activeTurns: new Map([
        ["chat-1", makeActiveTurn({ waitStartedAt: ts })],
        ["chat-2", makeActiveTurn({ waitStartedAt: null })],
      ]),
    })
    const result = getWaitStartedAtByChatId(deps)
    expect(result.get("chat-1")).toBe(ts)
    expect(result.has("chat-2")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getPendingTool
// ---------------------------------------------------------------------------

function parkTool(slots: PendingToolSlots, chatId: string, toolUseId: string, parkedAt = Date.now()): void {
  slots.park(chatId, {
    toolUseId,
    provider: "claude",
    tool: { toolKind: "ask_user_question" } as ParkedTool["tool"],
    parkedAt,
    resolve: () => undefined,
  })
}

describe("getPendingTool", () => {
  it("returns null when nothing is parked for the chat", () => {
    const deps = makeDeps()
    expect(getPendingTool(deps, "chat-x")).toBeNull()
    expect(getPendingTool(deps, "chat-1")).toBeNull()
  })

  it("returns PendingToolSnapshot when a request is parked — with or without a turn", () => {
    const slots = new PendingToolSlots()
    parkTool(slots, "chat-1", "tool-123")
    const deps = makeDeps({ pendingTools: slots })
    expect(getPendingTool(deps, "chat-1")).toEqual({ toolUseId: "tool-123", toolKind: "ask_user_question" })

    const withTurn = makeDeps({
      pendingTools: slots,
      activeTurns: new Map([["chat-1", makeActiveTurn()]]),
    })
    expect(getPendingTool(withTurn, "chat-1")).toEqual({ toolUseId: "tool-123", toolKind: "ask_user_question" })
  })
})

describe("pending-tool overlays", () => {
  it("getActiveStatuses reports waiting_for_user for an out-of-turn parked request", () => {
    const slots = new PendingToolSlots()
    parkTool(slots, "chat-1", "tool-123")
    const deps = makeDeps({ pendingTools: slots })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("waiting_for_user")
  })

  it("getActiveStatuses lets a live turn's status win over the slot overlay", () => {
    const slots = new PendingToolSlots()
    parkTool(slots, "chat-1", "tool-123")
    const deps = makeDeps({
      pendingTools: slots,
      activeTurns: new Map([["chat-1", makeActiveTurn({ status: "running" })]]),
    })
    expect(getActiveStatuses(deps).get("chat-1")).toBe("running")
  })

  it("getWaitStartedAtByChatId surfaces parkedAt for an out-of-turn parked request", () => {
    const slots = new PendingToolSlots()
    parkTool(slots, "chat-1", "tool-123", 4242)
    const deps = makeDeps({ pendingTools: slots })
    expect(getWaitStartedAtByChatId(deps).get("chat-1")).toBe(4242)
  })

  it("isClaudeSessionIdle never reaps a session with a parked request", () => {
    const slots = new PendingToolSlots()
    parkTool(slots, "chat-1", "tool-123")
    const session = makeSession({ lastUsedAt: 0 })
    const deps = makeDeps({
      pendingTools: slots,
      claudeSessions: new Map([["chat-1", session]]),
    })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getDrainingChatIds
// ---------------------------------------------------------------------------

describe("getDrainingChatIds", () => {
  it("returns empty set when no draining streams", () => {
    const deps = makeDeps()
    expect(getDrainingChatIds(deps).size).toBe(0)
  })

  it("returns chatIds of draining streams", () => {
    const draining = new Map<string, unknown>([["chat-a", {}], ["chat-b", {}]])
    const deps = makeDeps({ drainingStreams: draining as SessionStateQueryDeps["drainingStreams"] })
    const result = getDrainingChatIds(deps)
    expect(result.has("chat-a")).toBe(true)
    expect(result.has("chat-b")).toBe(true)
    expect(result.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// getClaudeSessionStates
// ---------------------------------------------------------------------------

describe("getClaudeSessionStates", () => {
  it("returns empty map when no sessions", () => {
    const deps = makeDeps()
    expect(getClaudeSessionStates(deps).size).toBe(0)
  })

  it("returns 'active' for SDK providers", () => {
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      activeTurns: new Map([["chat-1", makeActiveTurn({ provider: "claude" })]]),
      isClaudeSdkProvider: () => true,
    })
    expect(getClaudeSessionStates(deps).get("chat-1")).toBe("active")
  })

  it("returns 'warming' when background task pending", () => {
    const session = makeSession({ chatId: "chat-1", lastUsedAt: 0 })
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      hasPendingBackgroundTask: () => true,
      resolveClaudeIdleMs: () => 100,
    })
    expect(getClaudeSessionStates(deps).get("chat-1")).toBe("warming")
  })

  it("returns 'idle' when idle timeout elapsed and no activity", () => {
    const session = makeSession({ chatId: "chat-1", lastUsedAt: 0 })
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1, // 1 ms — already elapsed
    })
    expect(getClaudeSessionStates(deps).get("chat-1")).toBe("idle")
  })

  it("returns 'warming' when recently used and no activity", () => {
    const session = makeSession({ chatId: "chat-1", lastUsedAt: Date.now() })
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 600_000,
    })
    expect(getClaudeSessionStates(deps).get("chat-1")).toBe("warming")
  })
})

// ---------------------------------------------------------------------------
// isClaudeSessionIdle
// ---------------------------------------------------------------------------

describe("isClaudeSessionIdle", () => {
  it("returns false when provider is an SDK provider", () => {
    const session = makeSession({ lastUsedAt: 0 })
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", makeActiveTurn({ provider: "claude" })]]),
      isClaudeSdkProvider: () => true,
      resolveClaudeIdleMs: () => 1,
    })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })

  it("returns false when session has pending prompt seqs", () => {
    const session = makeSession({ lastUsedAt: 0, pendingPromptSeqs: [1] })
    const deps = makeDeps({ resolveClaudeIdleMs: () => 1 })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })

  it("returns false when chat has a live workflow", () => {
    const session = makeSession({ lastUsedAt: 0 })
    const deps = makeDeps({
      hasLiveWorkflow: () => true,
      resolveClaudeIdleMs: () => 1,
    })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })

  it("returns false when background task is pending", () => {
    const session = makeSession({ lastUsedAt: 0 })
    const deps = makeDeps({
      hasPendingBackgroundTask: () => true,
      resolveClaudeIdleMs: () => 1,
    })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })

  it("returns false when idle timeout has not elapsed", () => {
    const session = makeSession({ lastUsedAt: Date.now() })
    const deps = makeDeps({ resolveClaudeIdleMs: () => 600_000 })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(false)
  })

  it("returns true when all idle conditions met", () => {
    const session = makeSession({ lastUsedAt: 0, pendingPromptSeqs: [] })
    const deps = makeDeps({ resolveClaudeIdleMs: () => 1 })
    expect(isClaudeSessionIdle(deps, "chat-1", session, Date.now())).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// sweepIdleClaudeSessions
// ---------------------------------------------------------------------------

describe("sweepIdleClaudeSessions", () => {
  it("does nothing when no sessions", () => {
    const deps = makeDeps()
    sweepIdleClaudeSessions(deps, Date.now())
    expect((deps.closeClaudeSession as ReturnType<typeof mock>).mock.calls.length).toBe(0)
  })

  it("closes and emits state change for idle sessions", () => {
    const session = makeSession({ chatId: "chat-1", lastUsedAt: 0, pendingPromptSeqs: [] })
    const closeFn = mock<(chatId: string, session: ClaudeSessionState) => void>(() => undefined)
    const emitFn = mock<(chatId: string) => void>(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1,
      closeClaudeSession: closeFn,
      emitStateChange: emitFn,
    })
    sweepIdleClaudeSessions(deps, Date.now())
    expect(closeFn.mock.calls.length).toBe(1)
    expect(closeFn.mock.calls[0]?.[0]).toBe("chat-1")
    expect(emitFn.mock.calls.length).toBe(1)
    expect(emitFn.mock.calls[0]?.[0]).toBe("chat-1")
  })

  it("does not close non-idle sessions", () => {
    const session = makeSession({ chatId: "chat-1", lastUsedAt: Date.now(), pendingPromptSeqs: [] })
    const closeFn = mock(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 600_000,
      closeClaudeSession: closeFn,
    })
    sweepIdleClaudeSessions(deps, Date.now())
    expect(closeFn.mock.calls.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// sweepIdleClaudeSessions — background-task guard expiry escalation
// (adr-20260801-background-task-wake-escalation: an expired guard on a
// still-pending task must produce a visible wake, never a silent close)
// ---------------------------------------------------------------------------

describe("sweepIdleClaudeSessions background-task escalation", () => {
  function makeExpiredSession(overrides?: Partial<ClaudeSessionState>): ClaudeSessionState {
    return makeSession({
      chatId: "chat-1",
      lastUsedAt: 0,
      pendingPromptSeqs: [],
      backgroundTasks: new Map([["bsh1", { taskType: null, description: null, startedAt: 0 }]]),
      backgroundTaskDeadlineAt: Date.now() - 1,
      backgroundTaskWakeCount: 0,
      ...overrides,
    })
  }

  it("fires a wake instead of closing when the guard expires with budget left", () => {
    const session = makeExpiredSession()
    const closeFn = mock(() => undefined)
    const wakeFn = mock<SessionStateQueryDeps["wakeBackgroundTaskSession"]>(() => undefined)
    const now = Date.now()
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1,
      closeClaudeSession: closeFn,
      wakeBackgroundTaskSession: wakeFn,
    })
    sweepIdleClaudeSessions(deps, now)
    expect(closeFn.mock.calls.length).toBe(0)
    expect(wakeFn.mock.calls.length).toBe(1)
    expect(wakeFn.mock.calls[0]?.[0]).toBe("chat-1")
    expect(wakeFn.mock.calls[0]?.[1]).toEqual(["bsh1"])
    expect(wakeFn.mock.calls[0]?.[2]).toBe(1)
    expect(session.backgroundTaskWakeCount).toBe(1)
    expect(session.backgroundTaskDeadlineAt).toBe(now + 1_800_000)
  })

  it("consumes the wake budget across sweeps until the cap", () => {
    const session = makeExpiredSession()
    const wakeFn = mock<SessionStateQueryDeps["wakeBackgroundTaskSession"]>(() => undefined)
    const closeFn = mock(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1,
      resolveBackgroundTaskMaxWakes: () => 2,
      closeClaudeSession: closeFn,
      wakeBackgroundTaskSession: wakeFn,
    })
    let now = Date.now()
    sweepIdleClaudeSessions(deps, now)
    now = session.backgroundTaskDeadlineAt + 1
    sweepIdleClaudeSessions(deps, now)
    expect(wakeFn.mock.calls.length).toBe(2)
    expect(session.backgroundTaskWakeCount).toBe(2)
    expect(closeFn.mock.calls.length).toBe(0)
  })

  it("closes visibly (notify) once the wake budget is exhausted and the session is idle", () => {
    const session = makeExpiredSession({ backgroundTaskWakeCount: 3 })
    const closeFn = mock(() => undefined)
    const notifyFn = mock<SessionStateQueryDeps["notifyBackgroundTasksAbandoned"]>(() => undefined)
    const wakeFn = mock<SessionStateQueryDeps["wakeBackgroundTaskSession"]>(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1,
      closeClaudeSession: closeFn,
      notifyBackgroundTasksAbandoned: notifyFn,
      wakeBackgroundTaskSession: wakeFn,
    })
    sweepIdleClaudeSessions(deps, Date.now())
    expect(wakeFn.mock.calls.length).toBe(0)
    expect(closeFn.mock.calls.length).toBe(1)
    expect(notifyFn.mock.calls.length).toBe(1)
    expect(notifyFn.mock.calls[0]?.[0]).toBe("chat-1")
    expect(notifyFn.mock.calls[0]?.[1]).toEqual(["bsh1"])
    expect(session.backgroundTasks.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })

  it("defers the exhausted-budget close while the session was recently used", () => {
    const session = makeExpiredSession({ backgroundTaskWakeCount: 3, lastUsedAt: Date.now() })
    const closeFn = mock(() => undefined)
    const notifyFn = mock(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 600_000,
      closeClaudeSession: closeFn,
      notifyBackgroundTasksAbandoned: notifyFn,
    })
    sweepIdleClaudeSessions(deps, Date.now())
    expect(closeFn.mock.calls.length).toBe(0)
    expect(notifyFn.mock.calls.length).toBe(0)
    expect(session.backgroundTasks.size).toBe(1)
  })

  it("re-arms without consuming wake budget when a claude turn is active", () => {
    const session = makeExpiredSession()
    const wakeFn = mock(() => undefined)
    const closeFn = mock(() => undefined)
    const now = Date.now()
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      activeTurns: new Map([["chat-1", makeActiveTurn({ provider: "claude" })]]),
      isClaudeSdkProvider: () => true,
      resolveClaudeIdleMs: () => 1,
      closeClaudeSession: closeFn,
      wakeBackgroundTaskSession: wakeFn,
    })
    sweepIdleClaudeSessions(deps, now)
    expect(wakeFn.mock.calls.length).toBe(0)
    expect(closeFn.mock.calls.length).toBe(0)
    expect(session.backgroundTaskWakeCount).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(now + 1_800_000)
  })

  it("still closes sessions whose guard is empty (normal idle path unchanged)", () => {
    const session = makeSession({
      chatId: "chat-1",
      lastUsedAt: 0,
      backgroundTasks: new Map(),
      backgroundTaskDeadlineAt: 0,
    })
    const closeFn = mock(() => undefined)
    const deps = makeDeps({
      claudeSessions: new Map([["chat-1", session]]),
      resolveClaudeIdleMs: () => 1,
      closeClaudeSession: closeFn,
    })
    sweepIdleClaudeSessions(deps, Date.now())
    expect(closeFn.mock.calls.length).toBe(1)
  })
})
