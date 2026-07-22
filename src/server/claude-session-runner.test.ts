/**
 * Tests for the extracted runClaudeSession event-loop function.
 *
 * Each test builds a fake `RunClaudeSessionDeps` object, a fake `ClaudeSessionState`,
 * and an async-iterable stream of `HarnessEvent`s, then asserts the side effects
 * produced by the function.
 */

// NOTE: do NOT mock.module("../shared/log") here — Bun's mock.module mutates
// the global registry for the whole test run, turning shared/log into noops
// for every later test file (analytics.test.ts asserts real log output).

import { describe, test, expect } from "bun:test"
import { runClaudeSession } from "./claude-session-runner"
import type { RunClaudeSessionDeps } from "./claude-session-runner"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import type { HarnessEvent } from "./harness-types"
import type { TranscriptEntry } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ClaudeSessionState. Override individual fields as needed. */
function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  const fakeHandle = {
    provider: "claude" as const,
    stream: (async function* () {})() as AsyncIterable<HarnessEvent>,
    interrupt: async () => {},
    close: () => {},
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
  }
  return {
    id: "sess-1",
    chatId: "chat-1",
    session: fakeHandle,
    localPath: "/tmp/test",
    additionalDirectories: [],
    model: "claude-opus-4",
    planMode: false,
    sessionToken: null,
    accountInfoLoaded: false,
    nextPromptSeq: 1,
    pendingPromptSeqs: [],
    activeTokenId: null,
    oauthKeyMasked: null,
    oauthLabel: null,
    openrouterKeyMasked: null,
    openrouterModel: null,
    lastUsedAt: 0,
    backgroundTaskIds: new Set(),
    backgroundTaskDeadlineAt: 0,
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    ...overrides,
  }
}

/** Build a minimal ActiveTurn backed by a fake HarnessTurn. */
function makeActiveTurn(chatId: string, overrides: Partial<ActiveTurn> = {}): ActiveTurn {
  const fakeTurn = {
    provider: "claude" as const,
    stream: (async function* () {})() as AsyncIterable<HarnessEvent>,
    interrupt: async () => {},
    close: () => {},
  }
  return {
    chatId,
    provider: "claude",
    turn: fakeTurn,
    model: "claude-opus-4",
    planMode: false,
    status: "starting",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
    claudePromptSeq: 1,
    ...overrides,
  }
}

/** Create a fake stream from a list of HarnessEvents. */
async function* fakeStream(events: HarnessEvent[]): AsyncIterable<HarnessEvent> {
  for (const e of events) yield e
}

/** Build a fake result TranscriptEntry. */
function fakeResultEntry(isError: boolean, result = "ok"): TranscriptEntry {
  return {
    _id: "entry-1",
    createdAt: Date.now(),
    kind: "result",
    subtype: isError ? "error" : "success",
    isError,
    durationMs: 0,
    result,
  } as unknown as TranscriptEntry
}

/** Build a fake system_init TranscriptEntry. */
function fakeSystemInitEntry(): TranscriptEntry {
  return {
    _id: "entry-sys",
    createdAt: Date.now(),
    kind: "system_init",
    provider: "claude",
    model: "claude-opus-4",
    tools: [],
    agents: [],
    slashCommands: [],
    mcpServers: [],
  } as unknown as TranscriptEntry
}

/** Build a minimal RunClaudeSessionDeps with all fields as no-ops. */
function makeDeps(session: ClaudeSessionState, overrides: Partial<RunClaudeSessionDeps> = {}): RunClaudeSessionDeps {
  const sessions = new Map<string, ClaudeSessionState>()
  sessions.set(session.chatId, session)

  return {
    openrouterFirstEntryTimeoutMs: 30000,
    claudeSessions: sessions,
    activeTurns: new Map(),
    oauthPool: null,
    claudeLimitDetector: {
      detect: () => null,
      detectFromResultText: () => null,
    },
    claudeAuthErrorDetector: {
      detect: () => null,
      detectFromResultText: () => null,
    },
    throwOnClaudeSessionStart: false,
    store: {
      appendMessage: async () => {},
      recordTurnFailed: async () => {},
      setSessionTokenForProvider: async () => {},
      setPendingForkSessionToken: async () => {},
      recordTurnFinished: async () => {},
      setCompactFailureCount: async () => {},
      recordTurnCancelled: async () => {},
      getChat: () => null,
      recordSessionCommandsLoaded: async () => {},
    },
    emitStateChange: () => {},
    handleLimitDetection: async () => false,
    maybeRegisterSdkWorkflowsDir: () => {},
    getSubagents: () => [],
    resolveBackgroundTaskMaxMs: () => 3_600_000,
    mergeLocalCatalog: (cmds) => cmds,
    handleLimitError: async () => false,
    handleAuthFailure: async () => false,
    closeClaudeSession: () => {},
    maybeStartNextQueuedMessage: async () => {},
    resolveClaudeDriverPreference: () => "sdk",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runClaudeSession", () => {
  test("empty stream → session closed and emitStateChange called", async () => {
    const session = makeSession()
    const closeCalls: string[] = []
    const stateChangeChatIds: (string | undefined)[] = []

    session.session.close = () => closeCalls.push("closed")
    const deps = makeDeps(session, {
      emitStateChange: (chatId) => stateChangeChatIds.push(chatId),
    })
    // The session stream is empty (returns immediately)
    session.session.stream = fakeStream([])

    await runClaudeSession(deps, session)

    expect(closeCalls).toHaveLength(1)
    expect(stateChangeChatIds).toContain(session.chatId)
  })

  test("session_token event → setSessionTokenForProvider called when session is current", async () => {
    const session = makeSession({ pendingPromptSeqs: [] })
    const tokenCalls: { chatId: string; provider: string; token: string | null }[] = []

    const deps = makeDeps(session, {
      store: {
        ...makeDeps(session).store,
        setSessionTokenForProvider: async (chatId, provider, token) => {
          tokenCalls.push({ chatId, provider: String(provider), token })
        },
      },
    })
    session.session.stream = fakeStream([
      { type: "session_token", sessionToken: "tok-abc" },
    ])

    await runClaudeSession(deps, session)

    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0]).toMatchObject({ chatId: "chat-1", provider: "claude", token: "tok-abc" })
    expect(session.sessionToken).toBe("tok-abc")
  })

  test("session_token NOT persisted when session is no longer current", async () => {
    const session = makeSession()
    const tokenCalls: string[] = []

    // Remove the session from the map so it's "not current"
    const sessions = new Map<string, ClaudeSessionState>()
    // Don't add session — so get(session.chatId) returns undefined, !== session

    const deps = makeDeps(session, {
      claudeSessions: sessions,
      store: {
        ...makeDeps(session).store,
        setSessionTokenForProvider: async () => { tokenCalls.push("called") },
      },
    })
    session.session.stream = fakeStream([
      { type: "session_token", sessionToken: "tok-xyz" },
    ])

    await runClaudeSession(deps, session)

    expect(tokenCalls).toHaveLength(0)
  })

  test("session_token NOT persisted when cancelledResultPending > 0", async () => {
    const session = makeSession({ cancelledResultPending: 1 })
    const tokenCalls: string[] = []

    const deps = makeDeps(session, {
      store: {
        ...makeDeps(session).store,
        setSessionTokenForProvider: async () => { tokenCalls.push("called") },
      },
    })
    session.session.stream = fakeStream([
      { type: "session_token", sessionToken: "tok-skip" },
    ])

    await runClaudeSession(deps, session)

    expect(tokenCalls).toHaveLength(0)
  })

  test("session_token NOT persisted when suppressSessionTokenPersist is true", async () => {
    const session = makeSession({ suppressSessionTokenPersist: true })
    const tokenCalls: string[] = []

    const deps = makeDeps(session, {
      store: {
        ...makeDeps(session).store,
        setSessionTokenForProvider: async () => { tokenCalls.push("called") },
      },
    })
    session.session.stream = fakeStream([
      { type: "session_token", sessionToken: "tok-suppressed" },
    ])

    await runClaudeSession(deps, session)

    expect(tokenCalls).toHaveLength(0)
  })

  test("rate_limit event → handleLimitDetection called", async () => {
    const session = makeSession()
    const detectionCalls: { chatId: string; resetAt: number }[] = []

    const deps = makeDeps(session, {
      handleLimitDetection: async (chatId, detection) => {
        detectionCalls.push({ chatId, resetAt: detection.resetAt })
        return false
      },
    })
    const resetAt = Date.now() + 60000
    session.session.stream = fakeStream([
      { type: "rate_limit", rateLimit: { resetAt, tz: "UTC" } },
    ])

    await runClaudeSession(deps, session)

    expect(detectionCalls).toHaveLength(1)
    expect(detectionCalls[0]).toMatchObject({ chatId: "chat-1", resetAt })
  })

  test("cancelled result entry is suppressed and counter decremented", async () => {
    const session = makeSession({ cancelledResultPending: 1 })
    const appendCalls: string[] = []

    const deps = makeDeps(session, {
      store: {
        ...makeDeps(session).store,
        appendMessage: async (_chatId, _entry) => { appendCalls.push("appended") },
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: fakeResultEntry(true, "") },
    ])

    await runClaudeSession(deps, session)

    // The cancelled result entry should be swallowed — appendMessage NOT called
    expect(appendCalls).toHaveLength(0)
    // Counter decremented
    expect(session.cancelledResultPending).toBe(0)
  })

  test("system_init entry sets active turn status to running", async () => {
    const session = makeSession()
    const active = makeActiveTurn(session.chatId)
    const activeTurns = new Map([[session.chatId, active]])

    const deps = makeDeps(session, {
      activeTurns,
      store: {
        ...makeDeps(session).store,
        getChat: () => ({ compactFailureCount: 0, pendingForkSessionToken: null }),
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: fakeSystemInitEntry() },
    ])

    await runClaudeSession(deps, session)

    expect(active.status).toBe("running")
  })

  test("successful result entry calls recordTurnFinished and clears activeTurns", async () => {
    const session = makeSession()
    session.pendingPromptSeqs = [1]  // so completedClaudePromptSeq shifts to 1

    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 1 })
    const activeTurns = new Map([[session.chatId, active]])

    const finishedCalls: string[] = []
    const releaseCalls: string[] = []

    const deps = makeDeps(session, {
      activeTurns,
      oauthPool: { release: (chatId) => releaseCalls.push(chatId) },
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedCalls.push(chatId) },
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: fakeResultEntry(false, "success") },
    ])

    await runClaudeSession(deps, session)

    expect(finishedCalls).toHaveLength(1)
    expect(finishedCalls[0]).toBe("chat-1")
    // activeTurns should be cleared after result
    expect(activeTurns.size).toBe(0)
    // oauthPool.release called once (from result handling) + once (finally if still current)
    // Actually only result path, finally only if isCurrentSession & active?.provider=="claude" & not already deleted
    expect(releaseCalls.length).toBeGreaterThan(0)
  })

  test("error result entry (unhandled) calls recordTurnFailed with result text", async () => {
    const session = makeSession()
    session.pendingPromptSeqs = [1]

    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 1 })
    const activeTurns = new Map([[session.chatId, active]])
    const failedCalls: { chatId: string; reason: string }[] = []

    const deps = makeDeps(session, {
      activeTurns,
      store: {
        ...makeDeps(session).store,
        recordTurnFailed: async (chatId, reason) => { failedCalls.push({ chatId, reason }) },
        getChat: () => ({ compactFailureCount: 0, pendingForkSessionToken: null }),
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: fakeResultEntry(true, "Something went wrong") },
    ])

    await runClaudeSession(deps, session)

    expect(failedCalls.length).toBeGreaterThan(0)
    expect(failedCalls[0].chatId).toBe("chat-1")
    expect(failedCalls[0].reason).toBe("Something went wrong")
  })

  test("compact_boundary with proactiveCompactInjection (PTY driver) finalizes the turn", async () => {
    const session = makeSession()
    session.pendingPromptSeqs = [1]

    const active = makeActiveTurn(session.chatId, {
      claudePromptSeq: 1,
      proactiveCompactInjection: true,
    })
    const activeTurns = new Map([[session.chatId, active]])
    const finishedCalls: string[] = []
    const releaseCalls: string[] = []

    const deps = makeDeps(session, {
      activeTurns,
      oauthPool: { release: (chatId) => releaseCalls.push(chatId) },
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedCalls.push(chatId) },
        setCompactFailureCount: async () => {},
      },
      resolveClaudeDriverPreference: () => "pty",
    })
    const compactBoundaryEntry = {
      _id: "compact-1",
      createdAt: Date.now(),
      kind: "compact_boundary",
    } as unknown as TranscriptEntry
    session.session.stream = fakeStream([
      { type: "transcript", entry: compactBoundaryEntry },
    ])

    await runClaudeSession(deps, session)

    expect(finishedCalls).toHaveLength(1)
    expect(active.hasFinalResult).toBe(true)
    // activeTurns cleared in compact_boundary path
    expect(activeTurns.size).toBe(0)
  })

  test("tool_result with background task ID updates backgroundTaskIds and deadline", async () => {
    const session = makeSession()
    const taskId = "bgtask42"
    const toolResultContent = `\nCommand running in background with ID: ${taskId}\nSome other output`

    const bgToolResultEntry = {
      _id: "tool-res-1",
      createdAt: Date.now(),
      kind: "tool_result",
      content: toolResultContent,
    } as unknown as TranscriptEntry

    let resolveBackgroundCalled = 0
    const deps = makeDeps(session, {
      resolveBackgroundTaskMaxMs: () => {
        resolveBackgroundCalled++
        return 1_800_000
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: bgToolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.backgroundTaskIds.has(taskId)).toBe(true)
    expect(session.backgroundTaskDeadlineAt).toBeGreaterThan(0)
    expect(resolveBackgroundCalled).toBeGreaterThan(0)
  })

  test("status entry with backgroundTaskIdsSnapshot REPLACES the guard set", async () => {
    // Pre-arm with a stale id: the level signal must replace, not merge, so a
    // missed settle bookend can never wedge a stale running indicator.
    const session = makeSession({ backgroundTaskIds: new Set(["stale1"]) })

    const snapshotEntry = {
      _id: "status-snap-1",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 2 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["a6de6ce841521b5df", "bsh42"],
    } as unknown as TranscriptEntry

    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snapshotEntry }])

    await runClaudeSession(deps, session)

    expect([...session.backgroundTaskIds].sort()).toEqual(["a6de6ce841521b5df", "bsh42"])
    expect(session.backgroundTaskIds.has("stale1")).toBe(false)
    expect(session.backgroundTaskDeadlineAt).toBeGreaterThan(0)
  })

  test("empty backgroundTaskIdsSnapshot clears the guard set and deadline", async () => {
    const session = makeSession({
      backgroundTaskIds: new Set(["a1", "b2"]),
      backgroundTaskDeadlineAt: Date.now() + 100_000,
    })

    const snapshotEntry = {
      _id: "status-snap-2",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 0 running",
      hidden: true,
      backgroundTaskIdsSnapshot: [],
    } as unknown as TranscriptEntry

    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snapshotEntry }])

    await runClaudeSession(deps, session)

    expect(session.backgroundTaskIds.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })

  test("appending any transcript entry bumps lastUsedAt (self-wake turns keep the session warm)", async () => {
    // A task-notification self-wake streams entries without a Kanna-driven
    // turn, so lastUsedAt must track stream activity or the idle reaper kills
    // the session mid-work (chat dd05b76e, 2026-07-22).
    const session = makeSession({ lastUsedAt: 0 })

    const textEntry = {
      _id: "txt-1",
      createdAt: Date.now(),
      kind: "assistant_text",
      text: "working...",
    } as unknown as TranscriptEntry

    const before = Date.now()
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: textEntry }])

    await runClaudeSession(deps, session)

    expect(session.lastUsedAt).toBeGreaterThanOrEqual(before)
  })

  test("thrown exception with no limit/auth detection → error result appended and turn failed", async () => {
    const session = makeSession()
    const active = makeActiveTurn(session.chatId)
    const activeTurns = new Map([[session.chatId, active]])
    const appendedEntries: TranscriptEntry[] = []
    const failedReasons: string[] = []

    const error = new Error("network dropped")
    const throwingStream: AsyncIterable<HarnessEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(error) as Promise<IteratorResult<HarnessEvent>>,
        return: () => Promise.resolve({ done: true as const, value: undefined as unknown as HarnessEvent }),
      }),
    }

    const deps = makeDeps(session, {
      activeTurns,
      store: {
        ...makeDeps(session).store,
        appendMessage: async (_chatId, entry) => { appendedEntries.push(entry) },
        recordTurnFailed: async (_chatId, reason) => { failedReasons.push(reason) },
      },
    })
    session.session.stream = throwingStream

    await runClaudeSession(deps, session)

    expect(appendedEntries.length).toBeGreaterThan(0)
    const errEntry = appendedEntries.find((e) => (e as { kind: string }).kind === "result")
    expect(errEntry).toBeDefined()
    expect(failedReasons).toContain("network dropped")
  })

  test("stream ends without hasFinalResult → fail-close records turn failure", async () => {
    const session = makeSession()
    const active = makeActiveTurn(session.chatId, { hasFinalResult: false })
    const activeTurns = new Map([[session.chatId, active]])
    const failedReasons: string[] = []

    const deps = makeDeps(session, {
      activeTurns,
      store: {
        ...makeDeps(session).store,
        recordTurnFailed: async (_chatId, reason) => { failedReasons.push(reason) },
      },
    })
    // Stream produces NO result entry (empty stream), so hasFinalResult stays false
    session.session.stream = fakeStream([])

    await runClaudeSession(deps, session)

    // The finally block should fail-close since hasFinalResult is false and provider is "claude"
    expect(failedReasons).toContain("session stream ended without a result")
  })
})
