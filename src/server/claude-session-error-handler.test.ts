/**
 * Tests for the extracted session error-response handlers.
 *
 * Each test builds a minimal `SessionErrorHandlerDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect } from "bun:test"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import {
  acquireRotationSlot,
  handleLimitError,
  handleLimitDetection,
  handleAuthFailure,
  TOKEN_ROTATION_DEDUPE_WINDOW_MS,
  TOKEN_ROTATION_HERD_STAGGER_MS,
  TOKEN_ROTATION_SCHEDULE_DELAY_MS,
  type SessionErrorHandlerDeps,
  type TokenRotationDedupeEntry,
} from "./claude-session-error-handler"
import type { ClaudeSessionState } from "./claude-session-state"
import type { ActiveTurn } from "./claude-session-state"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { LimitDetection, LimitDetector } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHandle() {
  return {
    provider: "claude" as const,
    stream: (async function* () {})() as AsyncIterable<never>,
    interrupt: async () => {},
    close: () => {},
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
    pushChannelPrompt: async () => {},
  }
}

function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
    id: "sess-1",
    chatId: "chat-1",
    session: makeHandle(),
    localPath: "/tmp/project",
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
    lastUsedAt: Date.now(),
    backgroundTaskIds: new Set<string>(),
    backgroundTaskDeadlineAt: 0,
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    ...overrides,
  }
}

function makeActiveTurn(chatId = "chat-1"): ActiveTurn {
  return {
    chatId,
    provider: "claude",
    turn: null as never,
    model: "claude-opus-4",
    planMode: false,
    status: "running",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId: null,
  }
}

/** Fake LimitDetection */
function makeLimitDetection(resetAt = Date.now() + 60_000): LimitDetection {
  return { chatId: "chat-1", resetAt, tz: "system", raw: {} }
}

/** Build a minimal SessionErrorHandlerDeps. Override fields as needed. */
function makeDeps(overrides: Partial<SessionErrorHandlerDeps> = {}): SessionErrorHandlerDeps {
  const emittedEvents: AutoContinueEvent[] = []
  const appendedMessages: Array<{ chatId: string; entry: unknown }> = []
  const closedSessions: string[] = []

  return {
    tokenRotationDedupe: new Map<string, TokenRotationDedupeEntry>(),
    claudeSessions: new Map(),
    activeTurns: new Map(),
    oauthPool: null,
    store: {
      getAutoContinueEvents: () => [],
      appendAutoContinueEvent: async (ev) => { emittedEvents.push(ev) },
      recordTurnFailed: async () => {},
      appendMessage: async (chatId, entry) => { appendedMessages.push({ chatId, entry }) },
    },
    resolveAutoResumeFor: () => false,
    emitAutoContinueEvent: async (ev) => { emittedEvents.push(ev) },
    closeClaudeSession: (chatId) => { closedSessions.push(chatId) },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// acquireRotationSlot
// ---------------------------------------------------------------------------

describe("acquireRotationSlot", () => {
  test("null tokenId → always returns isFirst:true and 0 delay", () => {
    const deps = makeDeps()
    const result = acquireRotationSlot(deps, null)
    expect(result).toEqual({ extraDelayMs: 0, isFirst: true })
  })

  test("first call for a tokenId → isFirst:true, 0 delay, creates dedupe entry", () => {
    const deps = makeDeps()
    const result = acquireRotationSlot(deps, "tok-1")
    expect(result).toEqual({ extraDelayMs: 0, isFirst: true })
    expect(deps.tokenRotationDedupe.has("tok-1")).toBe(true)
  })

  test("second call within window → isFirst:false, extra delay = 1 × HERD_STAGGER", () => {
    const deps = makeDeps()
    acquireRotationSlot(deps, "tok-1") // first
    const result = acquireRotationSlot(deps, "tok-1") // second
    expect(result.isFirst).toBe(false)
    expect(result.extraDelayMs).toBe(TOKEN_ROTATION_HERD_STAGGER_MS)
  })

  test("third call within window → extra delay = 2 × HERD_STAGGER", () => {
    const deps = makeDeps()
    acquireRotationSlot(deps, "tok-1")
    acquireRotationSlot(deps, "tok-1")
    const result = acquireRotationSlot(deps, "tok-1")
    expect(result.extraDelayMs).toBe(2 * TOKEN_ROTATION_HERD_STAGGER_MS)
  })

  test("call after dedupe window expires → treated as first again", () => {
    const deps = makeDeps()
    // Seed an entry that's already expired
    deps.tokenRotationDedupe.set("tok-1", {
      firstSeenAt: Date.now() - TOKEN_ROTATION_DEDUPE_WINDOW_MS - 100,
      staggerCount: 5,
    })
    const result = acquireRotationSlot(deps, "tok-1")
    expect(result).toEqual({ extraDelayMs: 0, isFirst: true })
  })

  test("different token IDs are tracked independently", () => {
    const deps = makeDeps()
    acquireRotationSlot(deps, "tok-A")
    const result = acquireRotationSlot(deps, "tok-B")
    expect(result).toEqual({ extraDelayMs: 0, isFirst: true })
  })
})

// ---------------------------------------------------------------------------
// handleLimitError
// ---------------------------------------------------------------------------

describe("handleLimitError", () => {
  test("returns false when detector returns null (not a rate-limit error)", async () => {
    const deps = makeDeps()
    const detector: LimitDetector = { detect: () => null }
    const result = await handleLimitError(deps, "chat-1", detector, new Error("other"))
    expect(result).toBe(false)
  })

  test("returns true and delegates to handleLimitDetection when detection fires", async () => {
    const deps = makeDeps()
    const detection = makeLimitDetection()
    const detector: LimitDetector = { detect: () => detection }
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitError(deps, "chat-1", detector, new Error("rate limited"))
    expect(result).toBe(true)
    expect(emitted.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// handleLimitDetection
// ---------------------------------------------------------------------------

describe("handleLimitDetection", () => {
  test("returns true early when a live schedule already exists (deduplication guard)", async () => {
    const deps = makeDeps({
      store: {
        getAutoContinueEvents: () => [{
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "auto_continue_accepted",
          chatId: "chat-1",
          scheduleId: "sched-1",
          timestamp: Date.now(),
          scheduledAt: Date.now() + 60_000,
          tz: "system",
          source: "auto_setting",
          resetAt: Date.now() + 60_000,
          detectedAt: Date.now(),
        }],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async () => {},
      },
    })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(result).toBe(true)
    // No new event should be emitted — the guard bailed early
    expect(emitted.length).toBe(0)
  })

  test("emits auto_continue_proposed when no pool and no auto-resume", async () => {
    const deps = makeDeps({ oauthPool: null, resolveAutoResumeFor: () => false })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(result).toBe(true)
    expect(emitted[0]?.kind).toBe("auto_continue_proposed")
  })

  test("emits auto_continue_accepted with source auto_setting when auto-resume is on", async () => {
    const deps = makeDeps({ oauthPool: null, resolveAutoResumeFor: () => true })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(result).toBe(true)
    const ev = emitted[0]
    expect(ev?.kind).toBe("auto_continue_accepted")
    if (ev?.kind === "auto_continue_accepted") {
      expect(ev.source).toBe("auto_setting")
    }
  })

  test("emits auto_continue_accepted with source token_rotation and closes session when pool can rotate", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-old" })
    const closedSessions: string[] = []
    const emitted: AutoContinueEvent[] = []
    const turnsFailed: string[] = []

    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        pickActive: () => ({ id: "tok-new" } as never),
        earliestUnlimit: () => null,
      },
      claudeSessions: new Map([["chat-1", session]]),
      activeTurns: new Map(),
      closeClaudeSession: (chatId) => { closedSessions.push(chatId) },
      store: {
        getAutoContinueEvents: () => [],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async (chatId) => { turnsFailed.push(chatId) },
        appendMessage: async () => {},
      },
    })
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(result).toBe(true)
    expect(emitted[0]?.kind).toBe("auto_continue_accepted")
    if (emitted[0]?.kind === "auto_continue_accepted") {
      expect(emitted[0].source).toBe("token_rotation")
      expect(emitted[0].scheduledAt).toBeGreaterThanOrEqual(Date.now() + TOKEN_ROTATION_SCHEDULE_DELAY_MS - 1)
    }
    expect(closedSessions).toContain("chat-1")
    // No active turn → recordTurnFailed not called
    expect(turnsFailed).toHaveLength(0)
  })

  test("records turn failed and removes active turn when active turn exists", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-old" })
    const activeTurns = new Map([["chat-1", makeActiveTurn()]])
    const turnsFailed: string[] = []

    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        pickActive: () => ({ id: "tok-new" } as never),
        earliestUnlimit: () => null,
      },
      claudeSessions: new Map([["chat-1", session]]),
      activeTurns,
      closeClaudeSession: () => {},
      store: {
        getAutoContinueEvents: () => [],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async (chatId) => { turnsFailed.push(chatId) },
        appendMessage: async () => {},
      },
    })
    deps.emitAutoContinueEvent = async () => {}

    await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(turnsFailed).toContain("chat-1")
    expect(activeTurns.has("chat-1")).toBe(false)
  })

  test("appends auto_continue_prompt transcript entry when not rotating", async () => {
    const appendedMessages: Array<{ chatId: string; entry: { kind: string } }> = []
    const deps = makeDeps({
      oauthPool: null,
      resolveAutoResumeFor: () => false,
      store: {
        getAutoContinueEvents: () => [],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async (chatId, entry) => {
          appendedMessages.push({ chatId, entry: entry as { kind: string } })
        },
      },
    })
    deps.emitAutoContinueEvent = async () => {}

    await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(appendedMessages.some(m => m.chatId === "chat-1" && m.entry.kind === "auto_continue_prompt")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleAuthFailure
// ---------------------------------------------------------------------------

describe("handleAuthFailure", () => {
  const fakeDetection: AuthErrorDetection = { chatId: "chat-1", reason: "401 Unauthorized", raw: {} }

  test("returns true early when a live schedule already exists", async () => {
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      store: {
        getAutoContinueEvents: () => [{
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "auto_continue_accepted",
          chatId: "chat-1",
          scheduleId: "sched-1",
          timestamp: Date.now(),
          scheduledAt: Date.now() + 60_000,
          tz: "system",
          source: "auto_setting",
          resetAt: Date.now() + 60_000,
          detectedAt: Date.now(),
        }],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async () => {},
      },
    })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleAuthFailure(deps, session, fakeDetection)
    expect(result).toBe(true)
    expect(emitted.length).toBe(0)
  })

  test("emits auto_continue_proposed when pool cannot rotate", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-dead" })
    const emitted: AutoContinueEvent[] = []
    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        // pool has no other token
        pickActive: () => ({ id: "tok-dead" } as never),
        earliestUnlimit: () => null,
      },
    })
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleAuthFailure(deps, session, fakeDetection)
    expect(result).toBe(true)
    expect(emitted[0]?.kind).toBe("auto_continue_proposed")
  })

  test("emits auto_continue_accepted with token_rotation and closes session when pool can rotate", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-dead" })
    const closedSessions: string[] = []
    const emitted: AutoContinueEvent[] = []

    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        pickActive: () => ({ id: "tok-new" } as never),
        earliestUnlimit: () => null,
      },
      closeClaudeSession: (chatId) => { closedSessions.push(chatId) },
      activeTurns: new Map(),
    })
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleAuthFailure(deps, session, fakeDetection)
    expect(result).toBe(true)
    const ev = emitted[0]
    expect(ev?.kind).toBe("auto_continue_accepted")
    if (ev?.kind === "auto_continue_accepted") {
      expect(ev.source).toBe("token_rotation")
      expect(ev.tz).toBe("system")
    }
    expect(closedSessions).toContain("chat-1")
  })

  test("records turn failed when active turn exists at time of auth failure", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-dead" })
    const activeTurns = new Map([["chat-1", makeActiveTurn()]])
    const turnsFailed: string[] = []

    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        pickActive: () => ({ id: "tok-new" } as never),
        earliestUnlimit: () => null,
      },
      activeTurns,
      closeClaudeSession: () => {},
      store: {
        getAutoContinueEvents: () => [],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async (chatId) => { turnsFailed.push(chatId) },
        appendMessage: async () => {},
      },
    })
    deps.emitAutoContinueEvent = async () => {}

    await handleAuthFailure(deps, session, fakeDetection)
    expect(turnsFailed).toContain("chat-1")
    expect(activeTurns.has("chat-1")).toBe(false)
  })

  test("appends auto_continue_prompt transcript entry when not rotating", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-dead" })
    const appendedMessages: Array<{ chatId: string; entry: { kind: string } }> = []

    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        // same token id → no rotation
        pickActive: () => ({ id: "tok-dead" } as never),
        earliestUnlimit: () => null,
      },
      store: {
        getAutoContinueEvents: () => [],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async (chatId, entry) => {
          appendedMessages.push({ chatId, entry: entry as { kind: string } })
        },
      },
    })
    deps.emitAutoContinueEvent = async () => {}

    await handleAuthFailure(deps, session, fakeDetection)
    expect(appendedMessages.some(m => m.entry.kind === "auto_continue_prompt")).toBe(true)
  })

  test("markError is called only for the first detector in the herd window", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-dead" })
    const markErrorCalls: string[] = []
    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: (id) => { markErrorCalls.push(id) },
        pickActive: () => null,
        earliestUnlimit: () => null,
      },
    })
    deps.emitAutoContinueEvent = async () => {}

    await handleAuthFailure(deps, session, fakeDetection) // first → calls markError
    await handleAuthFailure(deps, session, fakeDetection) // second → skipped
    expect(markErrorCalls).toHaveLength(1)
  })
})
