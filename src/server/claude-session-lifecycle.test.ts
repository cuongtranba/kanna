/**
 * Tests for the extracted session-lifecycle standalone functions.
 *
 * Each test builds a minimal `SessionLifecycleDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect, beforeEach } from "bun:test"
import {
  resolveClaudeIdleMs,
  resolveClaudeMaxResident,
  hasLiveWorkflow,
  hasPendingBackgroundTask,
  closeClaudeSession,
  maybeRegisterSdkWorkflowsDir,
  enforceClaudeSessionBudget,
  buildPoolUnavailableMessage,
  type SessionLifecycleDeps,
} from "./claude-session-lifecycle"
import type { ClaudeSessionState } from "./claude-session-state"
import type { TokenUnavailability } from "./oauth-pool/oauth-token-pool"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake ClaudeSessionHandle. */
function makeFakeHandle() {
  return {
    provider: "claude" as const,
    stream: (async function* () {})() as AsyncIterable<never>,
    interrupt: async () => {},
    close: () => {},
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
  }
}

/** Build a minimal ClaudeSessionState. Override fields as needed. */
function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
    id: "sess-1",
    chatId: "chat-1",
    session: makeFakeHandle(),
    localPath: "/home/user/project",
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
    workflowsDirRegistered: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    ...overrides,
  }
}

/** Build a minimal SessionLifecycleDeps. Override fields as needed. */
function makeDeps(overrides: Partial<SessionLifecycleDeps> = {}): SessionLifecycleDeps {
  return {
    getAppSettingsSnapshot: () => ({}),
    defaultIdleMs: 600_000,
    defaultMaxResidentSessions: 3,
    claudeSessions: new Map(),
    activeTurns: new Map(),
    oauthPool: null,
    workflowRegistry: null,
    resolveClaudeDriverPreference: () => "sdk",
    emitStateChange: () => {},
    store: {
      getChat: () => null,
    },
    homeDir: "/home/testuser",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveClaudeIdleMs
// ---------------------------------------------------------------------------

describe("resolveClaudeIdleMs", () => {
  test("returns default when settings has no lifecycle override", () => {
    const deps = makeDeps({ defaultIdleMs: 300_000 })
    expect(resolveClaudeIdleMs(deps)).toBe(300_000)
  })

  test("returns settings value when valid positive number", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { idleTimeoutMs: 120_000 } },
      }),
      defaultIdleMs: 600_000,
    })
    expect(resolveClaudeIdleMs(deps)).toBe(120_000)
  })

  test("rounds fractional settings value", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { idleTimeoutMs: 120_001.7 } },
      }),
      defaultIdleMs: 600_000,
    })
    expect(resolveClaudeIdleMs(deps)).toBe(120_002)
  })

  test("falls back to default when settings value is zero", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { idleTimeoutMs: 0 } },
      }),
      defaultIdleMs: 600_000,
    })
    expect(resolveClaudeIdleMs(deps)).toBe(600_000)
  })

  test("falls back to default when settings value is negative", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { idleTimeoutMs: -1 } },
      }),
      defaultIdleMs: 600_000,
    })
    expect(resolveClaudeIdleMs(deps)).toBe(600_000)
  })

  test("falls back to default when settings value is Infinity", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { idleTimeoutMs: Infinity } },
      }),
      defaultIdleMs: 600_000,
    })
    expect(resolveClaudeIdleMs(deps)).toBe(600_000)
  })
})

// ---------------------------------------------------------------------------
// resolveClaudeMaxResident
// ---------------------------------------------------------------------------

describe("resolveClaudeMaxResident", () => {
  test("returns default when no override in settings", () => {
    const deps = makeDeps({ defaultMaxResidentSessions: 5 })
    expect(resolveClaudeMaxResident(deps)).toBe(5)
  })

  test("returns settings value when valid", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { maxConcurrent: 8 } },
      }),
      defaultMaxResidentSessions: 3,
    })
    expect(resolveClaudeMaxResident(deps)).toBe(8)
  })

  test("falls back to default when settings value is 0", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { maxConcurrent: 0 } },
      }),
      defaultMaxResidentSessions: 3,
    })
    expect(resolveClaudeMaxResident(deps)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// hasLiveWorkflow
// ---------------------------------------------------------------------------

describe("hasLiveWorkflow", () => {
  test("returns false when workflowRegistry is null", () => {
    const deps = makeDeps({ workflowRegistry: null })
    expect(hasLiveWorkflow(deps, "chat-1")).toBe(false)
  })

  test("returns false when registry says no active run", () => {
    const deps = makeDeps({
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => {},
        unregister: () => {},
      },
    })
    expect(hasLiveWorkflow(deps, "chat-1")).toBe(false)
  })

  test("returns true when registry reports an active run", () => {
    const deps = makeDeps({
      workflowRegistry: {
        hasActiveRun: () => true,
        register: () => {},
        unregister: () => {},
      },
    })
    expect(hasLiveWorkflow(deps, "chat-1")).toBe(true)
  })

  test("passes freshness from resolveClaudeIdleMs", () => {
    let capturedFreshness = 0
    const deps = makeDeps({
      defaultIdleMs: 999_000,
      workflowRegistry: {
        hasActiveRun: (_chatId, freshnessMs) => {
          capturedFreshness = freshnessMs
          return false
        },
        register: () => {},
        unregister: () => {},
      },
    })
    hasLiveWorkflow(deps, "chat-1")
    expect(capturedFreshness).toBe(999_000)
  })
})

// ---------------------------------------------------------------------------
// hasPendingBackgroundTask
// ---------------------------------------------------------------------------

describe("hasPendingBackgroundTask", () => {
  test("returns false when backgroundTaskIds is empty", () => {
    const session = makeSession({ backgroundTaskIds: new Set(), backgroundTaskDeadlineAt: 0 })
    expect(hasPendingBackgroundTask(session, Date.now())).toBe(false)
  })

  test("returns true when task ids present and deadline not expired", () => {
    const now = Date.now()
    const session = makeSession({
      backgroundTaskIds: new Set(["task-1"]),
      backgroundTaskDeadlineAt: now + 60_000,
    })
    expect(hasPendingBackgroundTask(session, now)).toBe(true)
  })

  test("returns false and clears state when deadline expired", () => {
    const now = Date.now()
    const session = makeSession({
      backgroundTaskIds: new Set(["task-1"]),
      backgroundTaskDeadlineAt: now - 1,
    })
    const result = hasPendingBackgroundTask(session, now)
    expect(result).toBe(false)
    expect(session.backgroundTaskIds.size).toBe(0)
    expect(session.backgroundTaskDeadlineAt).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// closeClaudeSession
// ---------------------------------------------------------------------------

describe("closeClaudeSession", () => {
  test("removes session from claudeSessions map", () => {
    const session = makeSession({ chatId: "chat-1" })
    const claudeSessions = new Map([["chat-1", session]])
    const deps = makeDeps({ claudeSessions })
    closeClaudeSession(deps, "chat-1", session)
    expect(claudeSessions.has("chat-1")).toBe(false)
  })

  test("calls session.close()", () => {
    let closed = false
    const session = makeSession()
    session.session.close = () => { closed = true }
    closeClaudeSession(makeDeps(), "chat-1", session)
    expect(closed).toBe(true)
  })

  test("releases oauth pool by default", () => {
    let releasedFor = ""
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      oauthPool: {
        release: (chatId) => { releasedFor = chatId },
        describeUnavailability: () => [],
      },
    })
    closeClaudeSession(deps, "chat-1", session)
    expect(releasedFor).toBe("chat-1")
  })

  test("skips oauth release when keepReservation is true", () => {
    let released = false
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      oauthPool: {
        release: () => { released = true },
        describeUnavailability: () => [],
      },
    })
    closeClaudeSession(deps, "chat-1", session, { keepReservation: true })
    expect(released).toBe(false)
  })

  test("unregisters workflow for SDK driver", () => {
    let unregisteredChat = ""
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      resolveClaudeDriverPreference: () => "sdk",
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => {},
        unregister: (chatId) => { unregisteredChat = chatId },
      },
    })
    closeClaudeSession(deps, "chat-1", session)
    expect(unregisteredChat).toBe("chat-1")
  })

  test("does NOT unregister workflow for PTY driver", () => {
    let unregistered = false
    const session = makeSession({ chatId: "chat-1" })
    const deps = makeDeps({
      resolveClaudeDriverPreference: () => "pty",
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => {},
        unregister: () => { unregistered = true },
      },
    })
    closeClaudeSession(deps, "chat-1", session)
    expect(unregistered).toBe(false)
  })

  test("does not error when session is already removed from map", () => {
    const session = makeSession({ chatId: "chat-1" })
    const differentSession = makeSession({ chatId: "chat-1" })
    const claudeSessions = new Map([["chat-1", differentSession]])
    const deps = makeDeps({ claudeSessions })
    // session !== claudeSessions.get("chat-1"), so map entry should survive
    closeClaudeSession(deps, "chat-1", session)
    expect(claudeSessions.has("chat-1")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// maybeRegisterSdkWorkflowsDir
// ---------------------------------------------------------------------------

describe("maybeRegisterSdkWorkflowsDir", () => {
  test("no-ops when workflowRegistry is null", () => {
    const session = makeSession({ sessionToken: "tok-abc" })
    const deps = makeDeps({ workflowRegistry: null })
    // Should not throw
    maybeRegisterSdkWorkflowsDir(deps, session)
    expect(session.workflowsDirRegistered).toBeFalsy()
  })

  test("no-ops when already registered", () => {
    let registered = false
    const session = makeSession({
      sessionToken: "tok-abc",
      workflowsDirRegistered: true,
    })
    const deps = makeDeps({
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => { registered = true },
        unregister: () => {},
      },
    })
    maybeRegisterSdkWorkflowsDir(deps, session)
    expect(registered).toBe(false)
  })

  test("no-ops when driver is PTY", () => {
    let registered = false
    const session = makeSession({ sessionToken: "tok-abc", workflowsDirRegistered: false })
    const deps = makeDeps({
      resolveClaudeDriverPreference: () => "pty",
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => { registered = true },
        unregister: () => {},
      },
    })
    maybeRegisterSdkWorkflowsDir(deps, session)
    expect(registered).toBe(false)
  })

  test("no-ops when sessionToken is null", () => {
    let registered = false
    const session = makeSession({ sessionToken: null, workflowsDirRegistered: false })
    const deps = makeDeps({
      workflowRegistry: {
        hasActiveRun: () => false,
        register: () => { registered = true },
        unregister: () => {},
      },
    })
    maybeRegisterSdkWorkflowsDir(deps, session)
    expect(registered).toBe(false)
  })

  test("registers and sets workflowsDirRegistered when all conditions met", () => {
    let registeredChat = ""
    let registeredDir = ""
    const session = makeSession({
      chatId: "chat-7",
      sessionToken: "session-abc123",
      // Use /tmp — an existing directory that realpathSync can resolve
      localPath: "/tmp",
      workflowsDirRegistered: false,
    })
    const deps = makeDeps({
      resolveClaudeDriverPreference: () => "sdk",
      homeDir: "/home/user",
      workflowRegistry: {
        hasActiveRun: () => false,
        register: (chatId, dir) => {
          registeredChat = chatId
          registeredDir = dir
        },
        unregister: () => {},
      },
    })
    maybeRegisterSdkWorkflowsDir(deps, session)
    expect(session.workflowsDirRegistered).toBe(true)
    expect(registeredChat).toBe("chat-7")
    // The dir should include the session token
    expect(registeredDir).toContain("session-abc123")
  })
})

// ---------------------------------------------------------------------------
// enforceClaudeSessionBudget
// ---------------------------------------------------------------------------

describe("enforceClaudeSessionBudget", () => {
  let emitted: string[]
  let activeTurns: Map<string, unknown>

  beforeEach(() => {
    emitted = []
    activeTurns = new Map()
  })

  function makeBudgetDeps(sessions: Map<string, ClaudeSessionState>, max: number): SessionLifecycleDeps {
    return makeDeps({
      getAppSettingsSnapshot: () => ({
        claudeDriver: { lifecycle: { maxConcurrent: max } },
      }),
      claudeSessions: sessions,
      activeTurns: activeTurns as Map<string, never>,
      emitStateChange: (chatId) => { emitted.push(chatId) },
    })
  }

  test("no-op when sessions at or below max", () => {
    const sessions = new Map([
      ["c1", makeSession({ chatId: "c1" })],
      ["c2", makeSession({ chatId: "c2" })],
    ])
    const deps = makeBudgetDeps(sessions, 2)
    enforceClaudeSessionBudget(deps)
    expect(sessions.size).toBe(2)
    expect(emitted.length).toBe(0)
  })

  test("evicts LRU idle session when over cap", () => {
    const now = Date.now()
    const older = makeSession({ chatId: "c1", lastUsedAt: now - 10_000 })
    const newer = makeSession({ chatId: "c2", lastUsedAt: now - 1_000 })
    const sessions = new Map<string, ClaudeSessionState>([
      ["c1", older],
      ["c2", newer],
      ["c3", makeSession({ chatId: "c3", lastUsedAt: now })],
    ])
    const deps = makeBudgetDeps(sessions, 2)
    enforceClaudeSessionBudget(deps)
    expect(sessions.size).toBe(2)
    expect(sessions.has("c1")).toBe(false)
    expect(emitted).toContain("c1")
  })

  test("skips protected chat even if oldest", () => {
    const now = Date.now()
    const oldest = makeSession({ chatId: "c1", lastUsedAt: now - 10_000 })
    const sessions = new Map<string, ClaudeSessionState>([
      ["c1", oldest],
      ["c2", makeSession({ chatId: "c2", lastUsedAt: now - 5_000 })],
      ["c3", makeSession({ chatId: "c3", lastUsedAt: now })],
    ])
    const deps = makeBudgetDeps(sessions, 2)
    enforceClaudeSessionBudget(deps, "c1")
    expect(sessions.has("c1")).toBe(true)
    expect(sessions.size).toBe(2)
    expect(emitted).not.toContain("c1")
  })

  test("skips sessions with an active turn", () => {
    const now = Date.now()
    const activeSession = makeSession({ chatId: "c1", lastUsedAt: now - 10_000 })
    activeTurns.set("c1", {})
    const sessions = new Map<string, ClaudeSessionState>([
      ["c1", activeSession],
      ["c2", makeSession({ chatId: "c2", lastUsedAt: now - 5_000 })],
      ["c3", makeSession({ chatId: "c3", lastUsedAt: now })],
    ])
    const deps = makeBudgetDeps(sessions, 2)
    enforceClaudeSessionBudget(deps)
    expect(sessions.has("c1")).toBe(true)
  })

  test("skips sessions with pending prompts", () => {
    const now = Date.now()
    const queued = makeSession({ chatId: "c1", lastUsedAt: now - 10_000, pendingPromptSeqs: [1] })
    const sessions = new Map<string, ClaudeSessionState>([
      ["c1", queued],
      ["c2", makeSession({ chatId: "c2", lastUsedAt: now - 5_000 })],
      ["c3", makeSession({ chatId: "c3", lastUsedAt: now })],
    ])
    const deps = makeBudgetDeps(sessions, 2)
    enforceClaudeSessionBudget(deps)
    expect(sessions.has("c1")).toBe(true)
  })

  test("no-op when max is 0 (unlimited)", () => {
    const sessions = new Map([
      ["c1", makeSession({ chatId: "c1" })],
      ["c2", makeSession({ chatId: "c2" })],
      ["c3", makeSession({ chatId: "c3" })],
    ])
    const deps = makeDeps({
      defaultMaxResidentSessions: 0,
      claudeSessions: sessions,
    })
    enforceClaudeSessionBudget(deps)
    expect(sessions.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// buildPoolUnavailableMessage
// ---------------------------------------------------------------------------

describe("buildPoolUnavailableMessage", () => {
  test("returns simple message when no pool configured", () => {
    const deps = makeDeps({ oauthPool: null })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", " for subagent")
    expect(msg).toBe(
      "All OAuth tokens are unavailable for subagent (rate-limited, errored, or in use)."
    )
  })

  test("includes pool header and footer when pool present", () => {
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("All OAuth tokens are unavailable:")
    expect(msg).toContain("Close the chat holding a contested token")
  })

  test("formats limited token with time remaining", () => {
    const now = Date.now()
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          { tokenId: "tok-1", label: "MyToken", reason: "limited", until: now + 30 * 60_000 },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("MyToken")
    expect(msg).toContain("rate-limited")
    expect(msg).toContain("30m")
  })

  test("formats reserved token with chat link", () => {
    const deps = makeDeps({
      store: {
        getChat: (id) => (id === "chat-abc" ? { title: "My Chat" } : null),
      },
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          {
            tokenId: "tok-1",
            label: "WorkToken",
            reason: "reserved",
            byChatIds: ["chat-abc"],
            ownedBySelf: false,
          },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("WorkToken")
    expect(msg).toContain("in use by")
    expect(msg).toContain("My Chat")
  })

  test("formats error token with message", () => {
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          { tokenId: "tok-2", label: "ErrToken", reason: "error", message: "invalid scope" },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("ErrToken")
    expect(msg).toContain("errored")
    expect(msg).toContain("invalid scope")
  })

  test("formats disabled token", () => {
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          { tokenId: "tok-3", label: "DisabledToken", reason: "disabled" },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("DisabledToken")
    expect(msg).toContain("disabled")
  })

  test("skips available tokens", () => {
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          { tokenId: "tok-4", label: "GoodToken", reason: "available" },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).not.toContain("GoodToken")
  })

  test("uses token id prefix when label is empty", () => {
    const deps = makeDeps({
      oauthPool: {
        release: () => {},
        describeUnavailability: (): TokenUnavailability[] => [
          { tokenId: "abcdef12345678", label: "", reason: "disabled" },
        ],
      },
    })
    const msg = buildPoolUnavailableMessage(deps, "chat-1", "")
    expect(msg).toContain("abcdef12")
  })
})
