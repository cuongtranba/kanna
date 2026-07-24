/**
 * Tests for the extracted spawnClaudeTurn function (claude-session-spawner.ts).
 * Covers session creation, reuse, eviction, OAuth pool handling, and driver selection
 * without touching AgentCoordinator internals.
 */

// NOTE: do NOT mock.module("../shared/log") here — Bun's mock.module mutates
// the global registry for the whole test run, turning shared/log into noops
// for every later test file (analytics.test.ts asserts real log output).

import { describe, test, expect } from "bun:test"
import { spawnClaudeTurn, type SpawnClaudeTurnArgs, type SpawnClaudeTurnDeps } from "./claude-session-spawner"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import type { ClaudeSessionHandle } from "./harness-types"
import type { LlmProviderSnapshot } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeHandle(overrides: Partial<ClaudeSessionHandle> = {}): ClaudeSessionHandle {
  return {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
    // getAccountInfo is optional — omit to keep the fake minimal
    pushChannelPrompt: undefined,
    ...overrides,
  }
}

/** A valid LlmProviderSnapshot for tests that exercise the OpenRouter path. */
function makeOpenRouterProvider(apiKey = "or-key"): LlmProviderSnapshot {
  return {
    provider: "openrouter",
    apiKey,
    model: "openai/gpt-4o",
    baseUrl: "https://openrouter.ai/api/v1",
    resolvedBaseUrl: "https://openrouter.ai/api/v1",
    enabled: true,
    warning: null,
    filePathDisplay: "",
  }
}

function makeSession(overrides: Partial<ClaudeSessionState> = {}): ClaudeSessionState {
  return {
    id: "sess-1",
    chatId: "chat-1",
    session: makeFakeHandle(),
    localPath: "/tmp/project",
    additionalDirectories: [],
    model: "claude-opus-4",
    effort: undefined,
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
    lastUsedAt: 0,
    backgroundTaskIds: new Set(),
    backgroundTaskDeadlineAt: 0,
    loopArmedAtSpawn: false,
    cancelledResultPending: 0,
    suppressSessionTokenPersist: false,
    ...overrides,
  }
}

function makeArgs(overrides: Partial<SpawnClaudeTurnArgs> = {}): SpawnClaudeTurnArgs {
  return {
    chatId: "chat-1",
    projectId: "proj-1",
    localPath: "/tmp/project",
    model: "claude-opus-4",
    planMode: false,
    sessionToken: null,
    forkSession: false,
    onToolRequest: async () => null,
    provider: "claude",
    ...overrides,
  }
}

function makeDeps(overrides: Partial<SpawnClaudeTurnDeps> = {}): SpawnClaudeTurnDeps {
  const claudeSessions = new Map<string, ClaudeSessionState>()
  const activeTurns = new Map<string, ActiveTurn>()
  const mentionedSubagentIdsByChat = new Map<string, string[]>()

  const fakeHandle = makeFakeHandle()

  return {
    claudeSessions,
    activeTurns,
    mentionedSubagentIdsByChat,
    oauthPool: null,
    store: {
      recordSessionCommandsLoaded: async () => {},
    },
    startClaudeSessionFn: async () => fakeHandle,
    startClaudeSessionPTYFn: async () => fakeHandle,
    subagentOrchestrator: {} as SpawnClaudeTurnDeps["subagentOrchestrator"],
    toolCallback: null,
    tunnelGateway: null,
    claudePtyRegistry: null,
    ptyInstanceRegistry: null,
    workflowRegistry: null,
    subagentTranscriptRegistry: null,
    resolveClaudeDriverPreference: () => "sdk",
    isLoopArmed: () => null,
    closeClaudeSession: () => {},
    enforceClaudeSessionBudget: () => {},
    // readLlmProvider is only called in the OpenRouter path — default throws to
    // surface accidental calls; override per-test when exercising that path.
    readLlmProvider: async () => { throw new Error("readLlmProvider called unexpectedly") },
    buildPoolUnavailableMessage: () => "pool unavailable",
    listOpenRouterModelsFn: null,
    getSubagents: () => [],
    getAppSettingsSnapshot: () => ({}),
    getEnabledCustomMcpServers: () => [],
    buildOAuthBearers: async () => new Map(),
    setupLoop: async () => ({ ok: false as const, errors: [] }),
    stopLoop: async () => {},
    runOrchestration: async () => ({ ok: true as const, runId: "run-1" }),
    cancelOrchRun: async () => {},
    getOrchRunDetail: () => null,
    resolveChatPolicy: () => POLICY_DEFAULT,
    runClaudeSession: () => {},
    emitStateChange: () => {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spawnClaudeTurn", () => {
  describe("fresh session spawn", () => {
    test("creates and registers a new ClaudeSessionState when no session exists", async () => {
      const deps = makeDeps()
      const args = makeArgs()

      const turn = await spawnClaudeTurn(deps, args)

      expect(deps.claudeSessions.size).toBe(1)
      const session = deps.claudeSessions.get("chat-1")
      expect(session).toBeDefined()
      expect(session?.chatId).toBe("chat-1")
      expect(session?.localPath).toBe("/tmp/project")
      expect(session?.model).toBe("claude-opus-4")
      expect(turn.provider).toBe("claude")
    })

    test("uses SDK driver when resolveClaudeDriverPreference returns sdk", async () => {
      let sdkCalled = false
      let ptyCalled = false
      const deps = makeDeps({
        resolveClaudeDriverPreference: () => "sdk",
        startClaudeSessionFn: async () => { sdkCalled = true; return makeFakeHandle() },
        startClaudeSessionPTYFn: async () => { ptyCalled = true; return makeFakeHandle() },
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "claude" }))

      expect(sdkCalled).toBe(true)
      expect(ptyCalled).toBe(false)
    })

    test("uses PTY driver when resolveClaudeDriverPreference returns pty", async () => {
      let sdkCalled = false
      let ptyCalled = false
      const deps = makeDeps({
        resolveClaudeDriverPreference: () => "pty",
        startClaudeSessionFn: async () => { sdkCalled = true; return makeFakeHandle() },
        startClaudeSessionPTYFn: async () => { ptyCalled = true; return makeFakeHandle() },
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "claude" }))

      expect(sdkCalled).toBe(false)
      expect(ptyCalled).toBe(true)
    })

    test("always uses SDK driver for openrouter provider even when pty is preferred", async () => {
      let sdkCalled = false
      let ptyCalled = false
      const deps = makeDeps({
        resolveClaudeDriverPreference: () => "pty",
        startClaudeSessionFn: async () => { sdkCalled = true; return makeFakeHandle() },
        startClaudeSessionPTYFn: async () => { ptyCalled = true; return makeFakeHandle() },
        readLlmProvider: async () => makeOpenRouterProvider("or-key"),
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "openrouter" }))

      expect(sdkCalled).toBe(true)
      expect(ptyCalled).toBe(false)
    })

    test("fires runClaudeSession in fire-and-forget manner", async () => {
      let sessionPassed: ClaudeSessionState | undefined
      const deps = makeDeps({
        runClaudeSession: (session) => { sessionPassed = session },
      })

      await spawnClaudeTurn(deps, makeArgs())

      expect(sessionPassed).toBeDefined()
      expect(sessionPassed?.chatId).toBe("chat-1")
    })

    test("calls enforceClaudeSessionBudget with chatId", async () => {
      const calls: Array<string | undefined> = []
      const deps = makeDeps({
        enforceClaudeSessionBudget: (chatId) => { calls.push(chatId) },
      })

      await spawnClaudeTurn(deps, makeArgs())

      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]).toBe("chat-1")
    })
  })

  describe("session reuse", () => {
    test("reuses existing session when localPath and effort are the same", async () => {
      const deps = makeDeps()
      const existingSession = makeSession({ lastUsedAt: 100 })
      deps.claudeSessions.set("chat-1", existingSession)

      let sdkCalled = false
      deps.startClaudeSessionFn = async () => { sdkCalled = true; return makeFakeHandle() }

      await spawnClaudeTurn(deps, makeArgs())

      expect(sdkCalled).toBe(false)
      expect(existingSession.lastUsedAt).toBeGreaterThan(100)
    })

    test("calls setModel on reuse when model changes", async () => {
      let modelSet: string | undefined
      const fakeHandle = makeFakeHandle({
        setModel: async (model) => { modelSet = model },
      })
      const deps = makeDeps()
      const existingSession = makeSession({ session: fakeHandle, model: "claude-opus-4" })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ model: "claude-sonnet-4" }))

      expect(modelSet).toBe("claude-sonnet-4")
      expect(existingSession.model).toBe("claude-sonnet-4")
    })

    test("calls setPermissionMode on reuse when planMode changes", async () => {
      let planModeSet: boolean | undefined
      const fakeHandle = makeFakeHandle({
        setPermissionMode: async (pm) => { planModeSet = pm },
      })
      const deps = makeDeps()
      const existingSession = makeSession({ session: fakeHandle, planMode: false })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ planMode: true }))

      expect(planModeSet).toBe(true)
      expect(existingSession.planMode).toBe(true)
    })
  })

  describe("session eviction", () => {
    test("evicts existing session and spawns fresh one when localPath changes", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({
        closeClaudeSession: (_, session) => { closedSession = session },
      })
      const existingSession = makeSession({ localPath: "/tmp/project" })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ localPath: "/tmp/other" }))

      expect(closedSession).toBe(existingSession)
      const newSession = deps.claudeSessions.get("chat-1")
      expect(newSession?.localPath).toBe("/tmp/other")
    })

    test("evicts existing session when forkSession is true", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({
        closeClaudeSession: (_, session) => { closedSession = session },
      })
      const existingSession = makeSession()
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ forkSession: true }))

      expect(closedSession).toBe(existingSession)
    })

    test("evicts existing session when loop armed state flips from false to true", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({
        closeClaudeSession: (_, session) => { closedSession = session },
        isLoopArmed: () => ({ subagentId: "sa-1", prompt: "loop", armedAt: 0, scheduleId: "s" }),
      })
      const existingSession = makeSession({ loopArmedAtSpawn: false })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs())

      expect(closedSession).toBe(existingSession)
      const newSession = deps.claudeSessions.get("chat-1")
      expect(newSession?.loopArmedAtSpawn).toBe(true)
    })
  })

  describe("OAuth pool handling", () => {
    test("throws OAuthPoolUnavailableError when pool has tokens but none available", async () => {
      const deps = makeDeps({
        oauthPool: {
          pickActive: () => null,
          hasAnyToken: () => true,
          markUsed: () => {},
          release: () => {},
        },
      })

      await expect(spawnClaudeTurn(deps, makeArgs({ provider: "claude" }))).rejects.toThrow(
        OAuthPoolUnavailableError,
      )
    })

    test("releases OAuth token when session spawn fails", async () => {
      let released = false
      const deps = makeDeps({
        oauthPool: {
          pickActive: () => ({ id: "tok-1", token: "tok-value", label: "test" }),
          hasAnyToken: () => true,
          markUsed: () => {},
          release: () => { released = true },
        },
        startClaudeSessionFn: async () => { throw new Error("spawn failed") },
        startClaudeSessionPTYFn: async () => { throw new Error("spawn failed") },
      })

      await expect(spawnClaudeTurn(deps, makeArgs())).rejects.toThrow("spawn failed")
      expect(released).toBe(true)
    })

    test("marks picked token as used and stores masked key in new session", async () => {
      let markedId: string | undefined
      const deps = makeDeps({
        oauthPool: {
          pickActive: () => ({ id: "tok-abc", token: "sk-ant-abcdef1234", label: "my-token" }),
          hasAnyToken: () => true,
          markUsed: (id) => { markedId = id },
          release: () => {},
        },
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "claude" }))

      expect(markedId).toBe("tok-abc")
      const session = deps.claudeSessions.get("chat-1")
      expect(session?.activeTokenId).toBe("tok-abc")
      expect(session?.oauthLabel).toBe("my-token")
    })
  })

  describe("return value", () => {
    test("returned HarnessTurn has provider=claude", async () => {
      const deps = makeDeps()
      const turn = await spawnClaudeTurn(deps, makeArgs())
      expect(turn.provider).toBe("claude")
    })

    test("returned HarnessTurn has an empty async-iterable stream", async () => {
      const deps = makeDeps()
      const turn = await spawnClaudeTurn(deps, makeArgs())
      const events: unknown[] = []
      for await (const e of turn.stream) {
        events.push(e)
      }
      expect(events).toHaveLength(0)
    })
  })
})
