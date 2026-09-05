import { describe, test, expect, mock, beforeEach } from "bun:test"


type FakeQuery = {
  accountInfo: () => Promise<unknown>
  interrupt: () => Promise<void>
  close: () => void
  setModel: (m: string) => Promise<void>
  setPermissionMode: (m: string) => Promise<void>
  supportedCommands: () => Promise<unknown[]>
}

let mockQueryFn: (args: unknown) => FakeQuery
let capturedQueryArgs: unknown

const defaultFakeQ = (): FakeQuery => ({
  accountInfo: async () => ({ provider: "claude", label: "test" }),
  interrupt: async () => {},
  close: () => {},
  setModel: async () => {},
  setPermissionMode: async () => {},
  supportedCommands: async () => [],
})

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => {
    capturedQueryArgs = args
    return mockQueryFn(args)
  },
}))

mock.module("./kanna-mcp", () => ({
  createKannaMcpServer: () => ({ transport: "stdio", command: "echo", args: [] }),
}))



import { startClaudeSession, type StartClaudeSessionDeps } from "./claude-session-start"


class FakeQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private _closed = false
  push(item: T) {
    if (this._closed) throw new Error("Cannot push to a closed queue")
    this.items.push(item)
  }
  close() { this._closed = true }
  get closed() { return this._closed }
  get pushedItems() { return [...this.items] }
  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    let i = 0
    return {
      next: async (): Promise<IteratorResult<T, undefined>> => {
        if (i < this.items.length) return { done: false, value: this.items[i++] }
        return { done: true, value: undefined }
      },
    }
  }
}

function makeFakeDeps(): StartClaudeSessionDeps {
  return {
    buildCanUseTool: () => async () => ({ behavior: "allow" as const }),
    buildClaudeEnv: (env) => env,
    loopBlockedNativeTools: [] as readonly string[],
    AsyncMessageQueueCtor: FakeQueue,
    toClaudeMessageStream: () => (async function* () {})(),
    createClaudeHarnessStream: () => (async function* () {})(),
    parseConfiguredContextWindowFromModelId: () => undefined,
    buildUserMcpServers: () => ({}),
    claudeToolset: ["Bash", "Read", "Write"] as readonly string[],
    sdkRestrictedFsNativeTools: ["Read", "Write"] as readonly string[],
  }
}

const BASE_ARGS = {
  projectId: "proj-1",
  localPath: "/tmp/test",
  model: "claude-opus-4-5",
  planMode: false,
  sessionToken: null,
  forkSession: false,
  oauthToken: null,
  onToolRequest: async () => null,
}

beforeEach(() => {
  mockQueryFn = defaultFakeQ
  capturedQueryArgs = undefined
})

describe("startClaudeSession", () => {
  test("returned handle has provider = 'claude'", async () => {
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    expect(handle.provider).toBe("claude")
  })

  test("returned handle exposes stream as async iterable", async () => {
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    expect(handle.stream).toBeDefined()
    expect(typeof handle.stream[Symbol.asyncIterator]).toBe("function")
  })

  test("returned handle exposes sendPrompt, setModel, setPermissionMode, getSupportedCommands, interrupt, close", async () => {
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    expect(typeof handle.sendPrompt).toBe("function")
    expect(typeof handle.setModel).toBe("function")
    expect(typeof handle.setPermissionMode).toBe("function")
    expect(typeof handle.getSupportedCommands).toBe("function")
    expect(typeof handle.interrupt).toBe("function")
    expect(typeof handle.close).toBe("function")
  })

  test("handle has no pushChannelPrompt when keepAlive is not set", async () => {
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    expect(handle.pushChannelPrompt).toBeUndefined()
  })

  test("handle exposes pushChannelPrompt when keepAlive: true", async () => {
    const handle = await startClaudeSession({ ...BASE_ARGS, keepAlive: true }, makeFakeDeps())
    expect(typeof handle.pushChannelPrompt).toBe("function")
  })

  test("close() can be called without throwing", async () => {
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    expect(() => handle.close()).not.toThrow()
  })

  test("getAccountInfo returns null when underlying accountInfo() throws", async () => {
    mockQueryFn = () => ({
      ...defaultFakeQ(),
      accountInfo: async () => { throw new Error("network error") },
    })
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    const info = await handle.getAccountInfo?.()
    expect(info).toBeNull()
  })

  test("getSupportedCommands returns [] when supportedCommands() throws", async () => {
    mockQueryFn = () => ({
      ...defaultFakeQ(),
      supportedCommands: async () => { throw new Error("not ready") },
    })
    const handle = await startClaudeSession(BASE_ARGS, makeFakeDeps())
    const cmds = await handle.getSupportedCommands()
    expect(cmds).toEqual([])
  })

  test("SDK options include the model passed to startClaudeSession", async () => {
    await startClaudeSession({ ...BASE_ARGS, model: "claude-sonnet-4-5" }, makeFakeDeps())
    const args = capturedQueryArgs as { options: { model: string } }
    expect(args.options.model).toBe("claude-sonnet-4-5")
  })

  test("SDK cwd equals localPath", async () => {
    await startClaudeSession({ ...BASE_ARGS, localPath: "/projects/myapp" }, makeFakeDeps())
    const args = capturedQueryArgs as { options: { cwd: string } }
    expect(args.options.cwd).toBe("/projects/myapp")
  })

  test("planMode:true maps to permissionMode 'plan'", async () => {
    await startClaudeSession({ ...BASE_ARGS, planMode: true }, makeFakeDeps())
    const args = capturedQueryArgs as { options: { permissionMode: string } }
    expect(args.options.permissionMode).toBe("plan")
  })

  test("planMode:false maps to permissionMode 'acceptEdits'", async () => {
    await startClaudeSession({ ...BASE_ARGS, planMode: false }, makeFakeDeps())
    const args = capturedQueryArgs as { options: { permissionMode: string } }
    expect(args.options.permissionMode).toBe("acceptEdits")
  })

  function envOfSpawn(): NodeJS.ProcessEnv {
    return (capturedQueryArgs as { options: { env: NodeJS.ProcessEnv } }).options.env
  }

  const isolatedEnvDeps = (): StartClaudeSessionDeps => ({
    ...makeFakeDeps(),
    buildClaudeEnv: (env) => ({ ...env, CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: undefined }),
  })

  test("a multi-root spawn carries CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", async () => {
    await startClaudeSession(
      { ...BASE_ARGS, additionalDirectories: ["/projects/api"] },
      isolatedEnvDeps(),
    )
    expect(envOfSpawn().CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBe("1")
  })

  test("a solo spawn does not", async () => {
    await startClaudeSession(BASE_ARGS, isolatedEnvDeps())
    expect(envOfSpawn().CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD).toBeUndefined()
  })
})
