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
import type { ClaudeSessionState, ActiveTurn, CompactionTurnKind } from "./claude-session-state"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"
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
    closed: Promise.resolve(),
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
    backgroundTasks: new Map(),
    selfWakeActive: false,
    recentToolDescriptions: new Map(),
    backgroundLaunchToolIds: new Set<string>(),
    backgroundTaskDeadlineAt: 0,
    backgroundTaskWakeCount: 0,
    backgroundTasksLevelSourced: false,
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    backgroundTaskWakeSuppressed: false,
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
    startedAt: Date.now(),
    model: "claude-opus-4",
    planMode: false,
    status: "starting",
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
    pendingTools: new PendingToolSlots(),
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
    },
    emitStateChange: () => {},
    handleLimitDetection: async () => false,
    maybeRegisterSdkWorkflowsDir: () => {},
    getSubagents: () => [],
    resolveBackgroundTaskMaxMs: () => 3_600_000,
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
  // A session torn down out of band (budget eviction, idle reap, /clear)
  // removes its own map entry BEFORE this runner's stream unwinds. Gating the
  // fail-close on "am I still the current session" therefore skipped it
  // entirely: the ActiveTurn survived with no terminal event, the chat
  // reported busy forever, and every consumer of that event — above all the
  // cron outcome observer — was starved.
  test("out-of-band close still fail-closes the turn it owned", async () => {
    const session = makeSession({ id: "sess-1" })
    const active = makeActiveTurn("chat-1", { sessionId: "sess-1" })
    const activeTurns = new Map([["chat-1", active]])
    const failures: string[] = []

    const deps = makeDeps(session, {
      activeTurns,
      // Evicted: closeClaudeSession already dropped the entry, and nothing
      // took its place.
      claudeSessions: new Map(),
      store: {
        ...makeDeps(session).store,
        recordTurnFailed: async (_chatId, message) => { failures.push(message) },
      },
    })
    session.session.stream = fakeStream([])

    await runClaudeSession(deps, session)

    expect(activeTurns.has("chat-1")).toBe(false)
    expect(failures).toHaveLength(1)
  })

  test("a turn belonging to a newer session is left untouched", async () => {
    const session = makeSession({ id: "sess-old" })
    const replacement = makeSession({ id: "sess-new" })
    const active = makeActiveTurn("chat-1", { sessionId: "sess-new" })
    const activeTurns = new Map([["chat-1", active]])
    const failures: string[] = []

    const deps = makeDeps(session, {
      activeTurns,
      claudeSessions: new Map([["chat-1", replacement]]),
      store: {
        ...makeDeps(session).store,
        recordTurnFailed: async (_chatId, message) => { failures.push(message) },
      },
    })
    session.session.stream = fakeStream([])

    await runClaudeSession(deps, session)

    expect(activeTurns.get("chat-1")).toBe(active)
    expect(failures).toHaveLength(0)
  })

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

  function runCompactBoundary(args: {
    compactionTurn: CompactionTurnKind
    driver: "pty" | "sdk"
  }) {
    const session = makeSession()
    session.pendingPromptSeqs = [1]

    const active = makeActiveTurn(session.chatId, {
      claudePromptSeq: 1,
      compactionTurn: args.compactionTurn,
    })
    const activeTurns = new Map([[session.chatId, active]])
    const finishedCalls: string[] = []
    const breakerCalls: number[] = []

    const deps = makeDeps(session, {
      activeTurns,
      oauthPool: { release: () => {} },
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedCalls.push(chatId) },
        setCompactFailureCount: async (_chatId, count) => { breakerCalls.push(count) },
      },
      resolveClaudeDriverPreference: () => args.driver,
    })
    const compactBoundaryEntry = {
      _id: "compact-1",
      createdAt: Date.now(),
      kind: "compact_boundary",
    } as unknown as TranscriptEntry
    session.session.stream = fakeStream([
      { type: "transcript", entry: compactBoundaryEntry },
    ])

    return { session, active, activeTurns, finishedCalls, breakerCalls, deps }
  }

  test("compact_boundary on a proactive compact (PTY) finalizes and resets the breaker", async () => {
    const ctx = runCompactBoundary({ compactionTurn: "proactive", driver: "pty" })

    await runClaudeSession(ctx.deps, ctx.session)

    expect(ctx.finishedCalls).toHaveLength(1)
    expect(ctx.active.hasFinalResult).toBe(true)
    expect(ctx.activeTurns.size).toBe(0)
    expect(ctx.session.pendingPromptSeqs).toEqual([])
    expect(ctx.breakerCalls).toEqual([0])
  })

  test("compact_boundary on a user-typed compact (PTY) finalizes without touching the breaker", async () => {
    const ctx = runCompactBoundary({ compactionTurn: "user", driver: "pty" })

    await runClaudeSession(ctx.deps, ctx.session)

    expect(ctx.finishedCalls).toHaveLength(1)
    expect(ctx.active.hasFinalResult).toBe(true)
    expect(ctx.activeTurns.size).toBe(0)
    expect(ctx.session.pendingPromptSeqs).toEqual([])
    expect(ctx.breakerCalls).toEqual([])
  })

  test("compact_boundary on a user-typed compact under the SDK driver does NOT finalize", async () => {
    const ctx = runCompactBoundary({ compactionTurn: "user", driver: "sdk" })

    await runClaudeSession(ctx.deps, ctx.session)

    expect(ctx.finishedCalls).toEqual([])
    expect(ctx.active.hasFinalResult).toBe(false)
    expect(ctx.session.pendingPromptSeqs).toEqual([1])
  })

  test("a failed user-typed compact never increments the breaker", async () => {
    const session = makeSession()
    session.pendingPromptSeqs = [1]

    const active = makeActiveTurn(session.chatId, {
      claudePromptSeq: 1,
      compactionTurn: "user",
    })
    const activeTurns = new Map([[session.chatId, active]])
    const breakerCalls: number[] = []

    const deps = makeDeps(session, {
      activeTurns,
      store: {
        ...makeDeps(session).store,
        recordTurnFailed: async () => {},
        getChat: () => ({ compactFailureCount: 0, pendingForkSessionToken: null }),
        setCompactFailureCount: async (_chatId, count) => { breakerCalls.push(count) },
      },
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: fakeResultEntry(true, "compact failed") },
    ])

    await runClaudeSession(deps, session)

    expect(breakerCalls).toEqual([])
  })

  test("tool_result with background task ID updates backgroundTaskIds and deadline", async () => {
    const session = makeSession()
    const taskId = "bgtask42"
    const toolId = "toolu_launch1"
    const toolResultContent = `\nCommand running in background with ID: ${taskId}\nSome other output`

    const bgToolCallEntry = {
      _id: "tool-call-1",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId,
        input: { command: "watch.sh", runInBackground: true } },
    } as unknown as TranscriptEntry

    const bgToolResultEntry = {
      _id: "tool-res-1",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId,
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
      { type: "transcript", entry: bgToolCallEntry },
      { type: "transcript", entry: bgToolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.has(taskId)).toBe(true)
    expect(session.backgroundTaskDeadlineAt).toBeGreaterThan(0)
    expect(resolveBackgroundCalled).toBeGreaterThan(0)
  })

  test("status entry with backgroundTaskIdsSnapshot REPLACES the guard set", async () => {
    // Pre-arm with a stale id: the level signal must replace, not merge, so a
    // missed settle bookend can never wedge a stale running indicator.
    const session = makeSession({ backgroundTasks: new Map([["stale1", { taskType: null, description: null, startedAt: 0, outputPath: null }]]) })

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

    expect([...session.backgroundTasks.keys()].sort()).toEqual(["a6de6ce841521b5df", "bsh42"])
    expect(session.backgroundTasks.has("stale1")).toBe(false)
    expect(session.backgroundTaskDeadlineAt).toBeGreaterThan(0)
  })

  test("empty backgroundTaskIdsSnapshot clears the guard set and deadline", async () => {
    const session = makeSession({
      backgroundTasks: new Map([["a1", { taskType: null, description: null, startedAt: 0, outputPath: null }], ["b2", { taskType: null, description: null, startedAt: 0, outputPath: null }]]),
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

    expect(session.backgroundTasks.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })

  test("empty→non-empty transition restores the watchdog wake budget (launch edge)", async () => {
    // A fresh watch epoch gets a fresh wake budget
    // (adr-20260801-background-task-wake-escalation).
    const session = makeSession({ backgroundTaskWakeCount: 3 })
    const bgToolCallEntry = {
      _id: "tool-call-reset",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "toolu_fresh",
        input: { command: "fresh.sh", runInBackground: true } },
    } as unknown as TranscriptEntry
    const bgToolResultEntry = {
      _id: "tool-res-reset",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_fresh",
      content: "Command running in background with ID: fresh1",
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([
      { type: "transcript", entry: bgToolCallEntry },
      { type: "transcript", entry: bgToolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.has("fresh1")).toBe(true)
    expect(session.backgroundTaskWakeCount).toBe(0)
  })

  test("empty→non-empty snapshot restores the wake budget; non-empty→non-empty keeps it", async () => {
    const session = makeSession({ backgroundTaskWakeCount: 2 })
    const snapA = {
      _id: "snap-reset-a",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 1 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["t1"],
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snapA }])
    await runClaudeSession(deps, session)
    expect(session.backgroundTaskWakeCount).toBe(0)

    // Same epoch continues (set stays non-empty): budget must NOT reset.
    session.backgroundTaskWakeCount = 1
    const snapB = {
      _id: "snap-reset-b",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 2 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["t1", "t2"],
    } as unknown as TranscriptEntry
    session.session.stream = fakeStream([{ type: "transcript", entry: snapB }])
    await runClaudeSession(deps, session)
    expect(session.backgroundTaskWakeCount).toBe(1)
  })

  test("a background_tasks_changed snapshot promotes the session to level-sourced", async () => {
    // adr-20260808-...-level-signal-authoritative: the SDK level signal is what
    // a consumer needing "is background work running" should hold, so its first
    // arrival retires the deadline for this session.
    const session = makeSession()
    expect(session.backgroundTasksLevelSourced).toBe(false)
    const snap = {
      _id: "snap-promote",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 1 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["ba35e96q4"],
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snap }])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasksLevelSourced).toBe(true)
  })

  test("the level-sourced flag survives an empty snapshot that clears the set", async () => {
    // Sticky: an EMPTY snapshot proves the signal works just as well as a
    // non-empty one, so the next launch on this session is trusted at once.
    const session = makeSession()
    const deps = makeDeps(session)
    const snap = (id: string, ids: string[]) => ({
      _id: id,
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks",
      hidden: true,
      backgroundTaskIdsSnapshot: ids,
    } as unknown as TranscriptEntry)

    session.session.stream = fakeStream([
      { type: "transcript", entry: snap("s1", ["t1"]) },
      { type: "transcript", entry: snap("s2", []) },
    ])
    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
    expect(session.backgroundTasksLevelSourced).toBe(true)
  })

  test("a launch tool_result paired with its tool_call does NOT promote the session (PTY invariant)", async () => {
    // The launch-regex fallback is the ONLY signal on PTY, where CLI >= 2.1.x
    // writes no system rows. Promoting on it would hand PTY sessions SDK
    // semantics they cannot support and disable their only keep-alive bound.
    const session = makeSession()
    const toolCallEntry = {
      _id: "tool-call-pty",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "toolu_pty1",
        input: { command: "watch.sh", runInBackground: true } },
    } as unknown as TranscriptEntry
    const bgToolResultEntry = {
      _id: "tool-res-no-promote",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_pty1",
      content: "Command running in background with ID: ptyonly1",
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([
      { type: "transcript", entry: toolCallEntry },
      { type: "transcript", entry: bgToolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.has("ptyonly1")).toBe(true)
    expect(session.backgroundTasksLevelSourced).toBe(false)
    expect(session.backgroundTaskDeadlineAt).toBeGreaterThan(Date.now())
  })

  test("a tool_result without a matching tool_call does not arm the background task guard (phantom-arm prevention)", async () => {
    // Scenario: the model reads another chat's transcript with Bash/Read and
    // the echoed content contains a launch marker. Without the provenance gate,
    // this would phantom-arm the guard for a task the session never launched.
    const session = makeSession()
    const readToolResultEntry = {
      _id: "tool-res-read",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_read1",
      content: "Command running in background with ID: phantom1. Output is being written to: /other-session/tasks/phantom1.output. You will be notified when it completes.",
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: readToolResultEntry }])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.has("phantom1")).toBe(false)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })

  test("backgroundTasksSnapshot meta labels tasks; surviving ids keep startedAt", async () => {
    const session = makeSession({
      backgroundTasks: new Map([["keep1", { taskType: null, description: "old label", startedAt: 111, outputPath: null }]]),
    })
    const snapshotEntry = {
      _id: "status-meta-1",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 2 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["keep1", "new2"],
      backgroundTasksSnapshot: [
        { id: "keep1", taskType: "local_bash", description: null },
        { id: "new2", taskType: "local_agent", description: "Watch CI checks" },
      ],
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snapshotEntry }])

    await runClaudeSession(deps, session)

    const keep = session.backgroundTasks.get("keep1")
    expect(keep?.startedAt).toBe(111)
    expect(keep?.taskType).toBe("local_bash")
    expect(keep?.description).toBe("old label")
    const fresh = session.backgroundTasks.get("new2")
    expect(fresh?.taskType).toBe("local_agent")
    expect(fresh?.description).toBe("Watch CI checks")
    expect(fresh?.startedAt).toBeGreaterThan(0)
  })

  test("launch tool_result inherits the launching tool_call's description", async () => {
    const session = makeSession()
    const toolCallEntry = {
      _id: "tc-bg-1",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: {
        kind: "tool",
        toolKind: "bash",
        toolName: "Bash",
        toolId: "toolu_bg1",
        input: { command: "sleep 600", description: "Watch the deploy", runInBackground: true },
      },
    } as unknown as TranscriptEntry
    const toolResultEntry = {
      _id: "tr-bg-1",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_bg1",
      content: "Command running in background with ID: bglabeled1",
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([
      { type: "transcript", entry: toolCallEntry },
      { type: "transcript", entry: toolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.backgroundTasks.get("bglabeled1")?.description).toBe("Watch the deploy")
  })

  test("SDK ordering: level snapshot before tool_result enriches outputPath and fires onBackgroundTaskLaunch once", async () => {
    // The SDK's background_tasks_changed level snapshot arrives ~1ms before the
    // Bash tool_result that carries the output path (observed in chat 3cf1de5c,
    // issue #806). The launch branch must enrich the existing entry with outputPath
    // rather than skip it, preserving snapshot-supplied taskType/description/startedAt.
    const session = makeSession()
    const snapshotEntry = {
      _id: "snap-sdk-order",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 1 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["b3tqaogys"],
      backgroundTasksSnapshot: [
        { id: "b3tqaogys", taskType: "local_bash", description: "Build pvs Go image" },
      ],
    } as unknown as TranscriptEntry
    const toolCallEntry = {
      _id: "tc-sdk-order",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "toolu_sdk1",
        input: { command: "build.sh", runInBackground: true } },
    } as unknown as TranscriptEntry
    const toolResultEntry = {
      _id: "tr-sdk-order",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_sdk1",
      content: "Command running in background with ID: b3tqaogys\nOutput is being written to: /tmp/b3tqaogys.output",
    } as unknown as TranscriptEntry

    const launched: Array<{ id: string; outputPath: string | null }> = []
    const deps = makeDeps(session, {
      onBackgroundTaskLaunch: (_chatId, id, outputPath) => launched.push({ id, outputPath }),
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: snapshotEntry },
      { type: "transcript", entry: toolCallEntry },
      { type: "transcript", entry: toolResultEntry },
    ])

    await runClaudeSession(deps, session)

    const task = session.backgroundTasks.get("b3tqaogys")
    expect(task?.outputPath).toBe("/tmp/b3tqaogys.output")
    expect(launched).toHaveLength(1)
    expect(launched[0]).toEqual({ id: "b3tqaogys", outputPath: "/tmp/b3tqaogys.output" })
    expect(task?.description).toBe("Build pvs Go image")
    expect(task?.taskType).toBe("local_bash")
  })

  test("SDK ordering: onBackgroundTaskLaunch not fired again when outputPath already known", async () => {
    // Guard: if somehow a tool_result arrives for an id whose outputPath is already set
    // (e.g. a replay scenario), do not double-fire trackTask — it would re-register
    // the file reader from offset 0.
    const session = makeSession({
      backgroundTasks: new Map([["known1", { taskType: "local_bash", description: "existing", startedAt: 100, outputPath: "/tmp/known1.output" }]]),
    })
    const toolCallEntry = {
      _id: "tc-no-double",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "toolu_nd1",
        input: { command: "repeat.sh", runInBackground: true } },
    } as unknown as TranscriptEntry
    const toolResultEntry = {
      _id: "tr-no-double",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "toolu_nd1",
      content: "Command running in background with ID: known1\nOutput is being written to: /tmp/known1.output",
    } as unknown as TranscriptEntry

    const launched: Array<{ id: string; outputPath: string | null }> = []
    const deps = makeDeps(session, {
      onBackgroundTaskLaunch: (_chatId, id, outputPath) => launched.push({ id, outputPath }),
    })
    session.session.stream = fakeStream([
      { type: "transcript", entry: toolCallEntry },
      { type: "transcript", entry: toolResultEntry },
    ])

    await runClaudeSession(deps, session)

    expect(launched).toHaveLength(0)
    expect(session.backgroundTasks.get("known1")?.outputPath).toBe("/tmp/known1.output")
  })

  test("self-wake: model entries with no active turn arm selfWakeActive; result disarms", async () => {
    const session = makeSession()
    const observed: boolean[] = []
    const deps = makeDeps(session, {
      emitStateChange: () => observed.push(session.selfWakeActive),
    })
    const assistantEntry = {
      _id: "sw-text-1",
      createdAt: Date.now(),
      kind: "assistant_text",
      text: "working on it",
    } as unknown as TranscriptEntry
    session.session.stream = fakeStream([
      { type: "transcript", entry: assistantEntry },
      { type: "transcript", entry: fakeResultEntry(false) },
    ])

    await runClaudeSession(deps, session)

    expect(observed).toContain(true)
    expect(session.selfWakeActive).toBe(false)
  })

  test("entries during an active Kanna turn never arm selfWakeActive", async () => {
    const session = makeSession()
    session.pendingPromptSeqs = [1]
    const active = makeActiveTurn(session.chatId)
    const deps = makeDeps(session, {
      activeTurns: new Map([[session.chatId, active]]),
    })
    const assistantEntry = {
      _id: "sw-text-2",
      createdAt: Date.now(),
      kind: "assistant_text",
      text: "normal turn output",
    } as unknown as TranscriptEntry
    session.session.stream = fakeStream([
      { type: "transcript", entry: assistantEntry },
    ])

    await runClaudeSession(deps, session)

    expect(session.selfWakeActive).toBe(false)
  })

  test("status snapshot entries alone never arm selfWakeActive", async () => {
    const session = makeSession()
    const snapshotEntry = {
      _id: "sw-snap-1",
      createdAt: Date.now(),
      kind: "status",
      status: "Background tasks: 1 running",
      hidden: true,
      backgroundTaskIdsSnapshot: ["t1"],
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([{ type: "transcript", entry: snapshotEntry }])

    await runClaudeSession(deps, session)

    expect(session.selfWakeActive).toBe(false)
  })

  test("backgroundTaskWakeSuppressed blocks self-wake arming (issue #819: Stop must prevent re-entry from pre-Stop tasks)", async () => {
    const session = makeSession({ backgroundTaskWakeSuppressed: true })
    const assistantEntry = {
      _id: "sw-suppressed-1",
      createdAt: Date.now(),
      kind: "assistant_text",
      text: "resuming after task completion",
    } as unknown as TranscriptEntry
    const deps = makeDeps(session)
    session.session.stream = fakeStream([
      { type: "transcript", entry: assistantEntry },
      { type: "transcript", entry: fakeResultEntry(false) },
    ])

    await runClaudeSession(deps, session)

    expect(session.selfWakeActive).toBe(false)
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

// ---------------------------------------------------------------------------
// Out-of-turn parked requests + self-wake lifecycle
//
// When the SDK self-resumes after a background-task notification it calls
// `canUseTool` outside any Kanna turn. The continuation parks in the
// per-chat PendingToolSlots — NO ActiveTurn is fabricated. The predecessor
// design rebuilt a "ghost" ActiveTurn to hold the resolve; every consumer of
// `activeTurns` then had to special-case it, and the one that didn't (the
// delete path) leaked the ghost forever: chat stuck "running", sends queued
// with no drain, selfWakeActive wedged true, idle reaper blocked
// (session 04fb43c9-fa05-406b-b552-c6e8c077c734).
// ---------------------------------------------------------------------------

/** Minimal ask_user_question tool call satisfying ParkedTool.tool. */
function askUserQuestionTool(toolId: string) {
  return {
    kind: "tool",
    toolKind: "ask_user_question",
    toolName: "ask_user_question",
    toolId,
    input: { questions: [] },
  } as unknown as ParkedTool["tool"]
}

function parkOutOfTurn(
  slots: PendingToolSlots,
  chatId: string,
  toolId: string,
  resolve: (value: unknown) => void = () => {},
): void {
  slots.park(chatId, {
    toolUseId: toolId,
    provider: "claude",
    tool: askUserQuestionTool(toolId),
    parkedAt: Date.now(),
    resolve,
  })
}

function fakeToolCallEntry(): TranscriptEntry {
  return {
    _id: "entry-tc",
    createdAt: Date.now(),
    kind: "tool_call",
    tool: {
      kind: "tool",
      toolKind: "other",
      toolName: "Bash",
      toolId: "toolu_bash",
      input: {},
    },
  } as unknown as TranscriptEntry
}

describe("runClaudeSession — self-wake + out-of-turn parked requests", () => {
  test("regression 04fb43c9: a self-wake with an answered question ends fully idle and drains the queue", async () => {
    // The incident sequence: background Agent completes → SDK self-wakes and
    // streams entries with no ActiveTurn → model asks AskUserQuestion
    // (parked out-of-turn) → user answers (slot taken) → wake keeps working
    // → terminal result. Afterward the chat must be COMPLETELY idle: no
    // turn, no wedged selfWakeActive, and the queued user message drains.
    const session = makeSession({ pendingPromptSeqs: [] })
    const pendingTools = new PendingToolSlots()
    const drainedFor: string[] = []
    const finishedFor: string[] = []

    const deps = makeDeps(session, {
      pendingTools,
      maybeStartNextQueuedMessage: async (chatId) => { drainedFor.push(chatId) },
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedFor.push(chatId) },
      },
    })

    let answered: unknown = null
    session.session.stream = (async function* () {
      yield { type: "entry", entry: fakeToolCallEntry() }
      parkOutOfTurn(pendingTools, session.chatId, "toolu_q", (v) => { answered = v })
      const taken = pendingTools.take(session.chatId, "toolu_q")
      taken?.resolve({ answers: { q1: "brides" } })
      yield { type: "entry", entry: fakeToolCallEntry() }
      yield { type: "entry", entry: fakeResultEntry(false) }
    })() as AsyncIterable<HarnessEvent>

    await runClaudeSession(deps, session)

    expect(answered).toMatchObject({ answers: { q1: "brides" } })
    expect(session.selfWakeActive).toBe(false)
    expect(deps.activeTurns.size).toBe(0)
    expect(pendingTools.has(session.chatId)).toBe(false)
    expect(finishedFor).toHaveLength(0)
    expect(drainedFor).toContain(session.chatId)
  })

  test("a wake result defensively discards a still-parked request", async () => {
    const session = makeSession({ pendingPromptSeqs: [] })
    const pendingTools = new PendingToolSlots()
    const resolved: unknown[] = []

    const deps = makeDeps(session, { pendingTools })
    session.session.stream = (async function* () {
      yield { type: "entry", entry: fakeToolCallEntry() }
      parkOutOfTurn(pendingTools, session.chatId, "toolu_q", (v) => { resolved.push(v) })
      yield { type: "entry", entry: fakeResultEntry(false) }
    })() as AsyncIterable<HarnessEvent>

    await runClaudeSession(deps, session)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ discarded: true })
    expect(pendingTools.has(session.chatId)).toBe(false)
    expect(session.selfWakeActive).toBe(false)
  })

  test("a parked continuation is settled, not dropped, when the stream ends", async () => {
    const session = makeSession({ pendingPromptSeqs: [] })
    const pendingTools = new PendingToolSlots()
    const resolved: unknown[] = []
    parkOutOfTurn(pendingTools, session.chatId, "toolu_q", (v) => { resolved.push(v) })
    session.selfWakeActive = true

    const deps = makeDeps(session, { pendingTools })
    session.session.stream = fakeStream([])

    await runClaudeSession(deps, session)

    // Never leave the SDK worker blocked inside canUseTool.
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ discarded: true })
    expect(pendingTools.has(session.chatId)).toBe(false)
    expect(session.selfWakeActive).toBe(false)
  })

  test("a real turn's finalize settles a parked request before dropping the turn", async () => {
    const session = makeSession({ pendingPromptSeqs: [5] })
    const pendingTools = new PendingToolSlots()
    const resolved: unknown[] = []
    parkOutOfTurn(pendingTools, session.chatId, "toolu_q", (v) => { resolved.push(v) })
    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 5 })

    const deps = makeDeps(session, {
      pendingTools,
      activeTurns: new Map([[session.chatId, active]]),
    })
    session.session.stream = fakeStream([{ type: "entry", entry: fakeResultEntry(false) }] as unknown as HarnessEvent[])

    await runClaudeSession(deps, session)

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ discarded: true })
    expect(deps.activeTurns.size).toBe(0)
  })

  test("a real turn with a matching prompt-seq still finalizes", async () => {
    const session = makeSession({ pendingPromptSeqs: [5] })
    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 5 })
    const finishedFor: string[] = []

    const deps = makeDeps(session, {
      activeTurns: new Map([[session.chatId, active]]),
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedFor.push(chatId) },
      },
    })
    session.session.stream = fakeStream([{ type: "entry", entry: fakeResultEntry(false) }] as unknown as HarnessEvent[])

    await runClaudeSession(deps, session)

    expect(finishedFor).toEqual([session.chatId])
  })

  test("a real turn whose seq was already drained is not finalized by a null completed seq", async () => {
    const session = makeSession({ pendingPromptSeqs: [] })
    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 5 })
    const finishedFor: string[] = []

    const deps = makeDeps(session, {
      activeTurns: new Map([[session.chatId, active]]),
      store: {
        ...makeDeps(session).store,
        recordTurnFinished: async (chatId) => { finishedFor.push(chatId) },
      },
    })
    session.session.stream = fakeStream([{ type: "entry", entry: fakeResultEntry(false) }] as unknown as HarnessEvent[])

    await runClaudeSession(deps, session)

    expect(finishedFor).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Mermaid guard hand-off
// ---------------------------------------------------------------------------

function fakeAssistantTextEntry(text: string): TranscriptEntry {
  return {
    _id: `entry-text-${text.length}`,
    createdAt: Date.now(),
    kind: "assistant_text",
    messageId: "m1",
    text,
  } as unknown as TranscriptEntry
}

describe("runClaudeSession — mermaid guard", () => {
  interface GuardHarness {
    deps: RunClaudeSessionDeps
    session: ClaudeSessionState
    calls: { chatId: string; text: readonly string[] }[]
    order: string[]
  }

  function guardHarness(entries: TranscriptEntry[], activeOverrides: Partial<ActiveTurn> = {}): GuardHarness {
    const session = makeSession({ pendingPromptSeqs: [1] })
    const active = makeActiveTurn(session.chatId, { claudePromptSeq: 1, ...activeOverrides })
    const calls: GuardHarness["calls"] = []
    const order: string[] = []

    const deps = makeDeps(session, {
      activeTurns: new Map([[session.chatId, active]]),
      maybeStartNextQueuedMessage: async () => { order.push("drain") },
      mermaidGuard: {
        check: async (chatId, text) => {
          calls.push({ chatId, text })
          order.push("guard")
        },
      },
    })
    session.session.stream = fakeStream(
      entries.map((entry) => ({ type: "entry", entry })) as unknown as HarnessEvent[],
    )
    return { deps, session, calls, order }
  }

  test("hands the turn's assistant text to the guard on a successful turn", async () => {
    const harness = guardHarness([
      fakeAssistantTextEntry("first block"),
      fakeAssistantTextEntry("```mermaid\nflowchart TD\n```"),
      fakeResultEntry(false),
    ])

    await runClaudeSession(harness.deps, harness.session)

    expect(harness.calls).toEqual([
      { chatId: harness.session.chatId, text: ["first block", "```mermaid\nflowchart TD\n```"] },
    ])
  })

  // A correction the guard enqueues has to be there before the drain looks,
  // or it sits until something else wakes the chat.
  test("runs before the queued-message drain", async () => {
    const harness = guardHarness([fakeAssistantTextEntry("text"), fakeResultEntry(false)])

    await runClaudeSession(harness.deps, harness.session)

    expect(harness.order).toEqual(["guard", "drain"])
  })

  test("stays out of a failed turn", async () => {
    const harness = guardHarness([fakeAssistantTextEntry("text"), fakeResultEntry(true, "boom")])

    await runClaudeSession(harness.deps, harness.session)

    expect(harness.calls).toEqual([])
  })

  test("stays out of a cancelled turn", async () => {
    const harness = guardHarness([fakeAssistantTextEntry("text"), fakeResultEntry(false)], {
      cancelRequested: true,
    })

    await runClaudeSession(harness.deps, harness.session)

    expect(harness.calls).toEqual([])
  })

  // A self-wake turn streams text with no ActiveTurn. Carrying it into the
  // next real turn would blame that turn for a diagram it never wrote.
  test("does not carry text across a turn boundary", async () => {
    const harness = guardHarness([
      fakeAssistantTextEntry("wake text"),
      fakeResultEntry(false),
      fakeAssistantTextEntry("real turn text"),
    ])
    harness.session.pendingPromptSeqs = [1, 1]

    await runClaudeSession(harness.deps, harness.session)

    expect(harness.calls[0]?.text).toEqual(["wake text"])
    expect(harness.calls[1]).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // Orphaned-stream self-wake barrier (issue #860)
  //
  // When cancelChat removes the ActiveTurn and sets cancelledResultPending > 0,
  // the SDK stream may keep flowing for seconds with model output belonging to
  // the cancelled prompt. Those entries must NOT arm selfWakeActive — there is
  // no new self-wake turn, only orphaned output from a turn already cancelled.
  // Without this guard each assistant_text / tool_call re-renders the chat as
  // "running" and the user needs repeated Stop presses.
  // ---------------------------------------------------------------------------

  test("orphaned stream entries after cancel do not arm selfWakeActive mid-stream (issue #860)", async () => {
    const session = makeSession({ cancelledResultPending: 1 })
    const observed: boolean[] = []
    const deps = makeDeps(session, {
      emitStateChange: () => observed.push(session.selfWakeActive),
    })

    const assistantEntry = {
      _id: "orphan-text-1",
      createdAt: Date.now(),
      kind: "assistant_text",
      text: "I'll start by pulling...",
    } as unknown as TranscriptEntry
    const toolCallEntry = {
      _id: "orphan-tool-1",
      createdAt: Date.now(),
      kind: "tool_call",
      tool: {
        toolId: "tc-1",
        toolKind: "bash",
        toolName: "Bash",
        input: { command: "git pull", runInBackground: false },
      },
    } as unknown as TranscriptEntry

    session.session.stream = fakeStream([
      { type: "transcript", entry: assistantEntry },
      { type: "transcript", entry: toolCallEntry },
      { type: "transcript", entry: fakeResultEntry(true, "") },
    ])

    await runClaudeSession(deps, session)

    expect(observed).not.toContain(true)
  })

test("a second Stop during the orphaned stream does not re-arm selfWakeActive via tool_result entries (issue #860)", async () => {
    const session = makeSession({ cancelledResultPending: 2 })
    const observed: boolean[] = []
    const deps = makeDeps(session, {
      emitStateChange: () => observed.push(session.selfWakeActive),
    })

    const toolResultEntry = {
      _id: "orphan-tr-1",
      createdAt: Date.now(),
      kind: "tool_result",
      toolId: "tc-1",
      content: "The user doesn't want to proceed with this tool use.",
      isError: true,
    } as unknown as TranscriptEntry

    session.session.stream = fakeStream([
      { type: "transcript", entry: toolResultEntry },
      { type: "transcript", entry: fakeResultEntry(true, "") },
    ])

    await runClaudeSession(deps, session)

    expect(observed).not.toContain(true)
  })
})
