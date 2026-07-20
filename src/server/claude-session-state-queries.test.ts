import { describe, it, expect, mock } from "bun:test"
import {
  getActiveStatuses,
  getWaitStartedAtByChatId,
  getPendingTool,
  getDrainingChatIds,
  getSlashCommandsLoadingChatIds,
  getClaudeSessionStates,
  isClaudeSessionIdle,
  sweepIdleClaudeSessions,
  type SessionStateQueryDeps,
} from "./claude-session-state-queries"
import type { ActiveTurn, ClaudeSessionState, PendingToolRequest } from "./claude-session-state"

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
    backgroundTaskIds: new Set(),
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
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    ...overrides,
  } as ActiveTurn
}

function makeDeps(overrides?: Partial<SessionStateQueryDeps>): SessionStateQueryDeps {
  return {
    activeTurns: new Map(),
    claudeSessions: new Map(),
    drainingStreams: new Map(),
    slashCommandsInFlight: new Set(),
    isClaudeSdkProvider: mock(() => false),
    hasPendingBackgroundTask: mock(() => false),
    resolveClaudeIdleMs: mock(() => 600_000),
    hasLiveWorkflow: mock(() => false),
    closeClaudeSession: mock(() => undefined),
    emitStateChange: mock(() => undefined),
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

describe("getPendingTool", () => {
  it("returns null when chatId has no active turn", () => {
    const deps = makeDeps()
    expect(getPendingTool(deps, "chat-x")).toBeNull()
  })

  it("returns null when active turn has no pending tool", () => {
    const deps = makeDeps({
      activeTurns: new Map([["chat-1", makeActiveTurn({ pendingTool: null })]]),
    })
    expect(getPendingTool(deps, "chat-1")).toBeNull()
  })

  it("returns PendingToolSnapshot when pending tool is present", () => {
    const deps = makeDeps({
      activeTurns: new Map([
        [
          "chat-1",
          makeActiveTurn({
            pendingTool: {
              toolUseId: "tool-123",
              tool: { toolKind: "ask_user_question" } as PendingToolRequest["tool"],
              resolve: () => undefined,
            },
          }),
        ],
      ]),
    })
    const result = getPendingTool(deps, "chat-1")
    expect(result).toEqual({ toolUseId: "tool-123", toolKind: "ask_user_question" })
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
// getSlashCommandsLoadingChatIds
// ---------------------------------------------------------------------------

describe("getSlashCommandsLoadingChatIds", () => {
  it("returns empty set when no slash commands in flight", () => {
    const deps = makeDeps()
    expect(getSlashCommandsLoadingChatIds(deps).size).toBe(0)
  })

  it("mirrors the slashCommandsInFlight set", () => {
    const deps = makeDeps({ slashCommandsInFlight: new Set(["chat-1", "chat-2"]) })
    const result = getSlashCommandsLoadingChatIds(deps)
    expect(result.has("chat-1")).toBe(true)
    expect(result.has("chat-2")).toBe(true)
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
