

import { describe, test, expect } from "bun:test"
import { spawnClaudeTurn, type SpawnClaudeTurnArgs, type SpawnClaudeTurnDeps } from "./claude-session-spawner"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import { ClaudeSessionState } from "./claude-session-state"
import type { ActiveTurn } from "./claude-session-state"
import type { ClaudeSessionHandle } from "./harness-types"
import type { LlmProviderSnapshot } from "../shared/types"
import type { CustomProviderCredential } from "../shared/custom-providers"


function makeFakeHandle(overrides: Partial<ClaudeSessionHandle> = {}): ClaudeSessionHandle {
  return {
    provider: "claude",
    stream: (async function* () {})(),
    interrupt: async () => {},
    close: () => {},
    closed: Promise.resolve(),
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    pushChannelPrompt: undefined,
    ...overrides,
  }
}

const CUSTOM_CREDENTIALS: Record<string, CustomProviderCredential> = {
  glm: { label: "GLM (Z.AI)", baseUrl: "https://api.z.ai/api/anthropic", apiKey: "glm-key-1234" },
  kimi: { label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/anthropic", apiKey: "kimi-key-5678" },
}

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

function makeSession(overrides: Partial<ConstructorParameters<typeof ClaudeSessionState>[0]> = {}): ClaudeSessionState {
  return new ClaudeSessionState({
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
    endpointKeyMasked: null,
    endpointModel: null,
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
  })
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
    isRunAlive: () => false,
    claudeSessions,
    activeTurns,
    mentionedSubagentIdsByChat,
    oauthPool: null,
    startClaudeSessionFn: async () => fakeHandle,
    subagentOrchestrator: {} as SpawnClaudeTurnDeps["subagentOrchestrator"],
    toolCallback: null,
    tunnelGateway: null,
    isLoopArmed: () => null,
    closeClaudeSession: () => {},
    enforceClaudeSessionBudget: () => {},
    readLlmProvider: async () => { throw new Error("readLlmProvider called unexpectedly") },
    getCustomProviderCredential: (id) => CUSTOM_CREDENTIALS[id] ?? null,
    buildPoolUnavailableMessage: () => "pool unavailable",
    listOpenRouterModelsFn: null,
    getSubagents: () => [],
    getAppSettingsSnapshot: () => ({}),
    getEnabledCustomMcpServers: () => [],
    buildOAuthBearers: async () => ({ byServerId: new Map(), usableUntil: null }),
    setupLoop: async () => ({ ok: false as const, errors: [] }),
    stopLoop: async () => {},
    resumeLoop: async () => ({ resumed: false, reason: "no_previous_loop" } as const),
    armCron: async () => ({ jobId: "cron-test" }),
    resolveChatPolicy: () => POLICY_DEFAULT,
    getCostBaselineUsd: () => undefined,
    runClaudeSession: () => {},
    emitStateChange: () => {},
    onCompaction: () => {},
    ...overrides,
  }
}


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

    test("starts an openrouter session through the SDK with the stored API key", async () => {
      let forwarded: { baseUrl: string; apiKey: string } | null | undefined
      const deps = makeDeps({
        startClaudeSessionFn: async (a) => { forwarded = a.endpoint; return makeFakeHandle() },
        readLlmProvider: async () => makeOpenRouterProvider("or-key"),
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "openrouter", model: "moonshotai/kimi-k2.5" }))

      expect(forwarded).toEqual({ baseUrl: "https://openrouter.ai/api", apiKey: "or-key" })
      expect(deps.claudeSessions.get("chat-1")?.endpointKey).toBe("openrouter")
    })

    test("starts a custom endpoint session on the SDK with the vendor model, the endpoint credentials and no OAuth token", async () => {
      let started: { model: string; endpoint: { baseUrl: string; apiKey: string } | null | undefined; oauthToken: string | null } | undefined
      let poolAsked = false
      const deps = makeDeps({
        oauthPool: {
          pickActive: () => { poolAsked = true; return { id: "t1", token: "oauth", label: "pool" } },
          hasAnyToken: () => true,
          markUsed: () => {},
          release: () => {},
        },
        startClaudeSessionFn: async (a) => {
          started = { model: a.model, endpoint: a.endpoint, oauthToken: a.oauthToken }
          return makeFakeHandle()
        },
      })

      await spawnClaudeTurn(deps, makeArgs({ provider: "custom", model: "glm/glm-5.3" }))

      expect(started).toEqual({
        model: "glm-5.3",
        endpoint: { baseUrl: "https://api.z.ai/api/anthropic", apiKey: "glm-key-1234" },
        oauthToken: null,
      })
      expect(poolAsked).toBe(false)
      const session = deps.claudeSessions.get("chat-1")
      expect(session?.model).toBe("glm/glm-5.3")
      expect(session?.endpointKey).toBe("custom:glm")
      expect(session?.endpointLabel).toBe("GLM (Z.AI)")
    })

    test("a vendor model id containing a slash reaches the SDK intact", async () => {
      let model: string | undefined
      const deps = makeDeps({ startClaudeSessionFn: async (a) => { model = a.model; return makeFakeHandle() } })

      await spawnClaudeTurn(deps, makeArgs({ provider: "custom", model: "glm/acme/glm-5.3:fast" }))

      expect(model).toBe("acme/glm-5.3:fast")
    })

    test("refuses a custom model that is not qualified with its provider", async () => {
      await expect(spawnClaudeTurn(makeDeps(), makeArgs({ provider: "custom", model: "glm-5.3" })))
        .rejects.toThrow("is not a custom endpoint model")
    })

    test("refuses a custom model whose provider was removed, naming it", async () => {
      const deps = makeDeps({ getCustomProviderCredential: () => null })

      await expect(spawnClaudeTurn(deps, makeArgs({ provider: "custom", model: "glm/glm-5.3" })))
        .rejects.toThrow("Custom provider 'glm' was removed — pick another model")
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

    test("switches model in place on the same custom endpoint, sending the vendor model", async () => {
      let modelSet: string | undefined
      const deps = makeDeps()
      const existingSession = makeSession({
        session: makeFakeHandle({ setModel: async (model) => { modelSet = model } }),
        model: "glm/glm-5.3",
        endpointKey: "custom:glm",
      })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ provider: "custom", model: "glm/glm-5.3-flash" }))

      expect(modelSet).toBe("glm-5.3-flash")
      expect(existingSession.model).toBe("glm/glm-5.3-flash")
    })

    test("respawns instead of switching model when the new model belongs to another custom endpoint", async () => {
      let closedSession: ClaudeSessionState | undefined
      let modelSet = false
      let started: { model: string; baseUrl: string | undefined } | undefined
      const deps = makeDeps({
        closeClaudeSession: (_, session) => { closedSession = session },
        startClaudeSessionFn: async (a) => {
          started = { model: a.model, baseUrl: a.endpoint?.baseUrl }
          return makeFakeHandle()
        },
      })
      const existingSession = makeSession({
        session: makeFakeHandle({ setModel: async () => { modelSet = true } }),
        model: "glm/glm-5.3",
        endpointKey: "custom:glm",
      })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs({ provider: "custom", model: "kimi/kimi-k3" }))

      expect(closedSession).toBe(existingSession)
      expect(modelSet).toBe(false)
      expect(started).toEqual({ model: "kimi-k3", baseUrl: "https://api.moonshot.ai/anthropic" })
      expect(deps.claudeSessions.get("chat-1")?.endpointKey).toBe("custom:kimi")
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
        isLoopArmed: () => ({ subagentId: "sa-1", prompt: "loop", armedAt: 0, scheduleId: "s", consecutiveFailures: 0, verifyCommand: null, workdirAbs: null, trackingFileRel: null, parallelism: 1 }),
      })
      const existingSession = makeSession({ loopArmedAtSpawn: false })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs())

      expect(closedSession).toBe(existingSession)
      const newSession = deps.claudeSessions.get("chat-1")
      expect(newSession?.loopArmedAtSpawn).toBe(true)
    })

    test("respawns a warm session whose MCP bearers are no longer usable, so the new process gets a fresh token", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({
        closeClaudeSession: (_, session) => { closedSession = session },
        buildOAuthBearers: async () => ({ byServerId: new Map([["srv", "fresh"]]), usableUntil: Date.now() + 840_000 }),
      })
      const existingSession = makeSession({ mcpBearersUsableUntil: Date.now() - 1 })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs())

      expect(closedSession).toBe(existingSession)
      expect(deps.claudeSessions.get("chat-1")?.mcpBearersUsableUntil).toBeGreaterThan(Date.now())
    })

    test("keeps a session whose bearers expired while it holds background work, since a respawn would kill that work", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({ closeClaudeSession: (_, session) => { closedSession = session } })
      const existingSession = makeSession({
        mcpBearersUsableUntil: Date.now() - 1,
        backgroundTasks: new Map([["task-1", { taskType: null, description: null, startedAt: 0, outputPath: null }]]),
        backgroundTasksLevelSourced: true,
      })
      deps.claudeSessions.set("chat-1", existingSession)

      await spawnClaudeTurn(deps, makeArgs())

      expect(closedSession).toBeUndefined()
    })

    test("keeps a session whose bearers are still usable", async () => {
      let closedSession: ClaudeSessionState | undefined
      const deps = makeDeps({ closeClaudeSession: (_, session) => { closedSession = session } })
      deps.claudeSessions.set("chat-1", makeSession({ mcpBearersUsableUntil: Date.now() + 60_000 }))

      await spawnClaudeTurn(deps, makeArgs())

      expect(closedSession).toBeUndefined()
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

describe("cost baseline wiring", () => {
  test("resuming a session hands the stored SDK running total to the new process", async () => {
    let baseline: number | undefined = -1
    const deps = makeDeps({
      getCostBaselineUsd: () => 0.42,
      startClaudeSessionFn: async (a) => {
        baseline = a.costBaselineUsd
        return makeFakeHandle()
      },
    })

    await spawnClaudeTurn(deps, makeArgs({ sessionToken: "sess-prior" }))

    expect(baseline).toBe(0.42)
  })

  test("a fresh session starts its running total from zero", async () => {
    let baseline: number | undefined = -1
    const deps = makeDeps({
      getCostBaselineUsd: () => 0.42,
      startClaudeSessionFn: async (a) => {
        baseline = a.costBaselineUsd
        return makeFakeHandle()
      },
    })

    await spawnClaudeTurn(deps, makeArgs({ sessionToken: null }))

    expect(baseline).toBeUndefined()
  })
})

describe("compaction observer wiring", () => {
  test("forwards onCompaction so the compaction hooks can be registered", async () => {
    let forwarded: unknown = "unset"
    const deps = makeDeps({
      startClaudeSessionFn: async (a) => {
        forwarded = a.onCompaction
        return makeFakeHandle()
      },
    })

    await spawnClaudeTurn(deps, makeArgs())

    expect(typeof forwarded).toBe("function")
  })
})

describe("delegation provenance", () => {
  test("a session in a live self-wake with no active turn still has a parent to delegate under", async () => {
    let context: Parameters<SpawnClaudeTurnDeps["startClaudeSessionFn"]>[0]["delegationContext"]
    const deps = makeDeps({
      startClaudeSessionFn: async (a) => {
        context = a.delegationContext
        return makeFakeHandle()
      },
    })
    await spawnClaudeTurn(deps, makeArgs())
    const session = deps.claudeSessions.get("chat-1")
    if (!session) throw new Error("session was not registered")
    expect(context?.getParentUserMessageId()).toBeNull()

    session.selfWakeActive = true

    expect(context?.getParentUserMessageId()).toBe(`self-wake:${session.id}`)
  })
})
