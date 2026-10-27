
import { describe, expect, test } from "vite-plus/test"
import {
  buildClaudeSubagentStarter,
  buildSubagentProviderRunForChat,
  type SubagentWiringDeps,
  type BuildSubagentProviderRunForChatArgs,
} from "./claude-subagent-wiring"
import type { ProviderRunStart } from "./subagent-orchestrator"
import type { Subagent } from "../shared/subagent-types"
import type { ToolCallbackService } from "./tool-callback"
import type { KannaMcpDelegationContext } from "./kanna-mcp"


const NOOP_PROMISE = () => Promise.resolve(null as unknown as never)

function makeDeps(overrides: Partial<SubagentWiringDeps> = {}): SubagentWiringDeps {
  const pendingResolvers = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  const fakeSession = { interrupt: () => {}, getAccountInfo: async () => null, close: () => {}, closed: Promise.resolve(), setModel: async () => {}, setPermissionMode: async () => {}, sendPrompt: NOOP_PROMISE, pushChannelPrompt: NOOP_PROMISE }

  return {
    store: {
      requireChat: (chatId) => ({
        id: chatId,
        projectId: "proj-1",
        provider: "claude",
        model: "claude-opus-4-5",
        effort: undefined,
        serviceTier: undefined,
        planMode: false,
        title: "Test chat",
        createdAt: 0,
        updatedAt: 0,
        tokenCount: 0,
        compactFailureCount: 0,
        policyOverride: undefined,
        stackProjectIds: [],
      } as never),
      getProject: (_id) => ({
        id: "proj-1",
        localPath: "/tmp/test-project",
        title: "Test Project",
        createdAt: 0,
        updatedAt: 0,
      } as never),
      getStack: () => null,
      appendSubagentEvent: async () => {},
    },
    startClaudeSessionFn: async (_a) => fakeSession as never,
    subagentOrchestrator: {
      notifySubagentToolPending: () => {},
    } as never,
    codexManager: {} as never,
    oauthPool: null,
    subagentPendingResolvers: pendingResolvers as never,
    realpath: (p) => p,
    getEnabledCustomMcpServers: () => [],
    buildOAuthBearers: async () => ({ byServerId: new Map(), usableUntil: null }),
    resolveChatPolicy: () => ({ mode: "acceptEdits" } as never),
    emitStateChange: () => {},
    buildPoolUnavailableMessage: () => "no token available",
    getAppSettingsSnapshot: () => ({}),
    readLlmProvider: async () => ({ provider: "claude", apiKey: null } as never),
    getCustomProviderCredential: () => null,
    ...overrides,
  }
}

const BASE_SUBAGENT = {
  id: "subagent-1",
  name: "Test Agent",
  description: "A test agent",
  provider: "claude" as const,
  model: "claude-opus-4-5",
  modelOptions: { reasoningEffort: "low" as const, contextWindow: "200k" as const },
  systemPrompt: "You are a test agent",
  contextScope: "full-transcript" as const,
  triggerMode: "manual" as const,
  workingDir: undefined,
  allowedPaths: undefined,
  maxTurns: undefined,
  updatedAt: 0,
  createdAt: 0,
}

const BASE_ARGS: BuildSubagentProviderRunForChatArgs = {
  subagent: BASE_SUBAGENT,
  chatId: "chat-1",
  primer: null,
  userInstruction: "do something",
  runId: "run-1",
  abortSignal: new AbortController().signal,
  depth: 0,
  ancestorSubagentIds: [],
  parentUserMessageId: "msg-1",
}


const DELEGATION_CONTEXT: KannaMcpDelegationContext = {
  parentSubagentId: "subagent-1",
  parentRunId: "run-1",
  ancestorSubagentIds: ["subagent-1"],
  depth: 1,
  getParentUserMessageId: () => "msg-1",
  getMentionedSubagentIds: () => [],
}

describe("buildClaudeSubagentStarter", () => {
  test("returns a function", () => {
    const starter = buildClaudeSubagentStarter(makeDeps(), { delegationContext: DELEGATION_CONTEXT, beaconToolsAllowed: false })
    expect(typeof starter).toBe("function")
  })

  test("calls startClaudeSessionFn with merged mcpServers", async () => {
    let capturedArgs: unknown = null
    const deps = makeDeps({
      startClaudeSessionFn: async (a) => {
        capturedArgs = a
        return {} as never
      },
      getEnabledCustomMcpServers: () => [{ id: "s1", name: "server1", transport: "stdio", command: "npx", args: [], env: {}, disabled: false }] as never,
      buildOAuthBearers: async () => ({ byServerId: new Map([["s1", "bearer-token"]]), usableUntil: null }),
    })
    const starter = buildClaudeSubagentStarter(deps, { delegationContext: DELEGATION_CONTEXT, beaconToolsAllowed: false })
    await starter({
      projectId: "proj",
      localPath: "/tmp/x",
      model: "claude-opus-4-5",
      effort: undefined,
      planMode: false,
      sessionToken: null,
      forkSession: false,
      oauthToken: null,
      onToolRequest: async () => null,
    } as never)

    expect(capturedArgs).not.toBeNull()
    const args = capturedArgs as Record<string, unknown>
    expect(Array.isArray(args.customMcpServers)).toBe(true)
    expect((args.customMcpServers as unknown[]).length).toBe(1)
    expect(args.oauthBearers).toBeInstanceOf(Map)
  })

  const PARENT_TOOL_CALLBACK: ToolCallbackService = {
    submit: async () => ({ status: "answered", decision: { kind: "deny", reason: "unused" } }),
    answer: async () => {},
    cancel: async () => {},
    cancelAllForChat: async () => {},
    recoverOnStartup: async () => {},
  }

  async function startWith(beaconToolsAllowed: boolean) {
    const captured: Parameters<SubagentWiringDeps["startClaudeSessionFn"]>[0][] = []
    const starter = buildClaudeSubagentStarter(
      makeDeps({
        toolCallback: PARENT_TOOL_CALLBACK,
        startClaudeSessionFn: async (a) => {
          captured.push(a)
          return {} as never
        },
      }),
      { delegationContext: DELEGATION_CONTEXT, beaconToolsAllowed },
    )
    await starter({
      projectId: "proj",
      localPath: "/tmp/x",
      model: "claude-opus-4-5",
      effort: undefined,
      planMode: false,
      sessionToken: null,
      forkSession: false,
      oauthToken: null,
      onToolRequest: async () => null,
    } as never)
    return captured[0]
  }

  test("a subagent granted beacon tools receives the parent's tool callback so its beacon approvals reach the user", async () => {
    const args = await startWith(true)
    expect(args?.kannaMcp?.beaconToolsAllowed).toBe(true)
    expect(args?.toolCallback).toBe(PARENT_TOOL_CALLBACK)
  })

  test("a subagent not granted beacon tools gets neither the flag nor a tool callback", async () => {
    const args = await startWith(false)
    expect(args?.kannaMcp?.beaconToolsAllowed).toBe(false)
    expect(args?.toolCallback).toBeUndefined()
  })
})


describe("buildSubagentProviderRunForChat", () => {
  test("returns a ProviderRunStart with a start function", () => {
    const result: ProviderRunStart = buildSubagentProviderRunForChat(makeDeps(), BASE_ARGS)
    expect(typeof result.start).toBe("function")
  })

  test("throws when project is not found", () => {
    const deps = makeDeps({
      store: {
        requireChat: (_chatId) => ({ id: _chatId, projectId: "proj-missing" } as never),
        getProject: (_id) => undefined,
        getStack: () => null,
        appendSubagentEvent: async () => {},
      },
    })
    expect(() => buildSubagentProviderRunForChat(deps, BASE_ARGS)).toThrow(
      "Project proj-missing not found for chat chat-1",
    )
  })

  test("delegation context increments depth and chains ancestorSubagentIds", () => {
    const args: BuildSubagentProviderRunForChatArgs = {
      ...BASE_ARGS,
      depth: 0,
      ancestorSubagentIds: [],
    }
    const result = buildSubagentProviderRunForChat(makeDeps(), args)
    expect(typeof result.start).toBe("function")
  })
})


describe("buildSubagentProviderRunForChat — authReady", () => {
  const authReadyFor = (deps: SubagentWiringDeps, provider: Subagent["provider"] = "claude") =>
    buildSubagentProviderRunForChat(deps, {
      ...BASE_ARGS,
      subagent: { ...BASE_SUBAGENT, provider },
    }).authReady()

  const poolWith = (hasAny: boolean, usable: boolean) =>
    ({
      hasAnyToken: () => hasAny,
      hasUsable: () => usable,
      pickActive: () => null,
      markUsed: () => {},
    }) as unknown as SubagentWiringDeps["oauthPool"]

  test("claude is ready with no pool configured — local CLI credentials", async () => {
    expect(await authReadyFor(makeDeps({ oauthPool: null }))).toBe(true)
  })

  test("claude is ready with an empty pool — matches the main-chat spawn gate", async () => {
    expect(await authReadyFor(makeDeps({ oauthPool: poolWith(false, false) }))).toBe(true)
  })

  test("claude is ready when the pool holds a usable token", async () => {
    expect(await authReadyFor(makeDeps({ oauthPool: poolWith(true, true) }))).toBe(true)
  })

  test("claude is NOT ready when tokens exist but none are usable", async () => {
    expect(await authReadyFor(makeDeps({ oauthPool: poolWith(true, false) }))).toBe(false)
  })

  test("readiness does not depend on a claudeAuth.authenticated settings flag", async () => {
    const deps = makeDeps({ oauthPool: poolWith(false, false), getAppSettingsSnapshot: () => ({}) })
    expect(await authReadyFor(deps)).toBe(true)
  })

  test("openrouter still gates on its own provider snapshot", async () => {
    const deps = makeDeps({
      readLlmProvider: async () => ({ provider: "openrouter", apiKey: "", enabled: true }) as never,
    })
    expect(await authReadyFor(deps, "openrouter")).toBe(false)
  })

  test("a custom subagent is ready only while its provider still holds an API key", async () => {
    const custom = (apiKey: string | null) => (id: string) =>
      id === "glm" && apiKey !== null ? { label: "GLM", baseUrl: "https://api.z.ai/api/anthropic", apiKey, contextWindow: null } : null
    const run = (getCustomProviderCredential: SubagentWiringDeps["getCustomProviderCredential"], model: string) =>
      buildSubagentProviderRunForChat(makeDeps({ getCustomProviderCredential }), {
        ...BASE_ARGS,
        subagent: { ...BASE_SUBAGENT, provider: "custom", model },
      }).authReady()

    expect(await run(custom("glm-key"), "glm/glm-5.3")).toBe(true)
    expect(await run(custom(null), "glm/glm-5.3")).toBe(false)
    expect(await run(custom("glm-key"), "glm-5.3")).toBe(false)
  })

  test("non-claude, non-openrouter providers are always ready", async () => {
    expect(await authReadyFor(makeDeps({ oauthPool: poolWith(true, false) }), "codex")).toBe(true)
  })
})

describe("buildSubagentProviderRunForChat — custom endpoint session", () => {
  const OLLAMA_CREDENTIAL = {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434",
    apiKey: "ollama",
    contextWindow: 65536,
  }

  async function startedWith(credential: typeof OLLAMA_CREDENTIAL | null, provider: "custom" | "claude", model: string) {
    const captured: Parameters<SubagentWiringDeps["startClaudeSessionFn"]>[0][] = []
    const deps = makeDeps({
      getCustomProviderCredential: () => credential,
      startClaudeSessionFn: async (a) => {
        captured.push(a)
        return {
          provider: "claude",
          stream: (async function* () {})(),
          interrupt: async () => {},
          close: () => {},
          closed: Promise.resolve(),
        } as never
      },
    })
    await buildSubagentProviderRunForChat(deps, {
      ...BASE_ARGS,
      subagent: { ...BASE_SUBAGENT, provider, model },
    }).start(() => {}, () => {})
    return captured[0]
  }

  test("a custom subagent starts on its endpoint with Claude model names mapped to its model and the endpoint's window", async () => {
    const started = await startedWith(OLLAMA_CREDENTIAL, "custom", "ollama/qwen3.6:35b-a3b-coding")

    expect(started?.model).toBe("qwen3.6:35b-a3b-coding")
    expect(started?.endpoint).toEqual({
      baseUrl: "http://localhost:11434",
      apiKey: "ollama",
      aliasModel: "qwen3.6:35b-a3b-coding",
      contextWindow: 65536,
    })
    expect(started?.contextWindowOverride).toBe(65536)
  })

  test("a Claude subagent starts with no endpoint and no window override", async () => {
    const started = await startedWith(null, "claude", "claude-opus-4-5")

    expect(started?.endpoint).toBeNull()
    expect(started?.contextWindowOverride).toBeUndefined()
  })
})
