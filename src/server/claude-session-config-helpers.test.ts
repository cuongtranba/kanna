import { describe, test, expect, mock, beforeEach } from "bun:test"
import {
  resolveClaudeDriverPreference,
  getEnabledCustomMcpServers,
  buildOAuthBearers,
  resolveChatPolicy,
  killPtyInstance,
  type ClaudeSessionConfigHelpersDeps,
} from "./claude-session-config-helpers"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { McpServerConfig, McpOAuthState } from "../shared/types"

// ---------------------------------------------------------------------------
// Helpers / stubs
// ---------------------------------------------------------------------------

function makeServer(overrides: Partial<McpServerConfig & { enabled: boolean }> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "test-server",
    enabled: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastTest: { status: "none" as const },
    transport: "http",
    url: "https://example.com/mcp",
    headers: {},
    ...overrides,
  } as McpServerConfig
}

function makeDeps(overrides: Partial<ClaudeSessionConfigHelpersDeps> = {}): ClaudeSessionConfigHelpersDeps {
  return {
    getAppSettingsSnapshot: () => ({}),
    chatPolicy: POLICY_DEFAULT,
    store: { state: null },
    ptyInstanceRegistry: null,
    ensureFreshToken: async () => "test-token",
    persistOAuthState: null,
    killProcessTree: async (_pid) => {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveClaudeDriverPreference
// ---------------------------------------------------------------------------

describe("resolveClaudeDriverPreference", () => {
  const originalEnv = process.env.KANNA_CLAUDE_DRIVER

  beforeEach(() => {
    delete process.env.KANNA_CLAUDE_DRIVER
  })

  test("returns 'pty' when settings preference is 'pty'", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({ claudeDriver: { preference: "pty" } }),
    })
    expect(resolveClaudeDriverPreference(deps)).toBe("pty")
  })

  test("returns 'sdk' when settings preference is 'sdk'", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({ claudeDriver: { preference: "sdk" } }),
    })
    expect(resolveClaudeDriverPreference(deps)).toBe("sdk")
  })

  test("falls through to env var when settings have no preference", () => {
    process.env.KANNA_CLAUDE_DRIVER = "pty"
    const deps = makeDeps({ getAppSettingsSnapshot: () => ({}) })
    expect(resolveClaudeDriverPreference(deps)).toBe("pty")
    // restore
    process.env.KANNA_CLAUDE_DRIVER = originalEnv ?? ""
    if (!originalEnv) delete process.env.KANNA_CLAUDE_DRIVER
  })

  test("defaults to 'sdk' when no settings and no env var", () => {
    const deps = makeDeps({ getAppSettingsSnapshot: () => ({}) })
    expect(resolveClaudeDriverPreference(deps)).toBe("sdk")
  })
})

// ---------------------------------------------------------------------------
// getEnabledCustomMcpServers
// ---------------------------------------------------------------------------

describe("getEnabledCustomMcpServers", () => {
  test("returns only enabled servers", () => {
    const enabled = makeServer({ id: "s1", enabled: true })
    const disabled = makeServer({ id: "s2", enabled: false })
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({ customMcpServers: [enabled, disabled] }),
    })
    const result = getEnabledCustomMcpServers(deps)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("s1")
  })

  test("returns empty array when customMcpServers is not an array", () => {
    const deps = makeDeps({ getAppSettingsSnapshot: () => ({}) })
    expect(getEnabledCustomMcpServers(deps)).toEqual([])
  })

  test("returns empty array when all servers are disabled", () => {
    const deps = makeDeps({
      getAppSettingsSnapshot: () => ({
        customMcpServers: [makeServer({ enabled: false })],
      }),
    })
    expect(getEnabledCustomMcpServers(deps)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildOAuthBearers
// ---------------------------------------------------------------------------

describe("buildOAuthBearers", () => {
  test("skips stdio servers", async () => {
    const ensureFreshToken = mock(async () => "token")
    const deps = makeDeps({ ensureFreshToken })
    const stdioServer = makeServer({ transport: "stdio", command: "node", args: [], env: {} })
    const result = await buildOAuthBearers(deps, [stdioServer as McpServerConfig])
    expect(result.size).toBe(0)
    expect(ensureFreshToken).not.toHaveBeenCalled()
  })

  test("skips unauthenticated servers", async () => {
    const ensureFreshToken = mock(async () => "token")
    const unauthOauth: McpOAuthState = { enabled: true, status: "unauthenticated" }
    const server = makeServer({ oauth: unauthOauth })
    const deps = makeDeps({ ensureFreshToken })
    const result = await buildOAuthBearers(deps, [server])
    expect(result.size).toBe(0)
    expect(ensureFreshToken).not.toHaveBeenCalled()
  })

  test("fetches token for authenticated network servers and stores by id", async () => {
    const ensureFreshToken = mock(async () => "bearer-xyz")
    const authOauth: McpOAuthState = { enabled: true, status: "authenticated" }
    const server = makeServer({ id: "srv-auth", oauth: authOauth })
    const deps = makeDeps({ ensureFreshToken })
    const result = await buildOAuthBearers(deps, [server])
    expect(result.size).toBe(1)
    expect(result.get("srv-auth")).toBe("bearer-xyz")
    expect(ensureFreshToken).toHaveBeenCalledTimes(1)
  })

  test("calls persistOAuthState when token is refreshed", async () => {
    const persisted: Array<{ id: string; oauth: McpOAuthState }> = []
    const authOauth: McpOAuthState = { enabled: true, status: "authenticated" }
    const server = makeServer({ id: "srv-p", oauth: authOauth })
    const deps = makeDeps({
      ensureFreshToken: async (_s, opts) => {
        opts.persist(authOauth)
        return "new-token"
      },
      persistOAuthState: (id, oauth) => { persisted.push({ id, oauth }) },
    })
    await buildOAuthBearers(deps, [server])
    expect(persisted).toHaveLength(1)
    expect(persisted[0].id).toBe("srv-p")
  })

  test("continues processing other servers when one throws", async () => {
    const authOauth: McpOAuthState = { enabled: true, status: "authenticated" }
    const bad = makeServer({ id: "bad", oauth: authOauth })
    const good = makeServer({ id: "good", oauth: authOauth, name: "good-server" })
    const ensureFreshToken = mock(async (s: McpServerConfig) => {
      if (s.id === "bad") throw new Error("refresh failed")
      return "good-token"
    })
    const deps = makeDeps({ ensureFreshToken })
    const result = await buildOAuthBearers(deps, [bad, good])
    expect(result.has("bad")).toBe(false)
    expect(result.get("good")).toBe("good-token")
  })
})

// ---------------------------------------------------------------------------
// resolveChatPolicy
// ---------------------------------------------------------------------------

describe("resolveChatPolicy", () => {
  test("returns base chatPolicy when store has no state", () => {
    const deps = makeDeps({ store: { state: null } })
    const result = resolveChatPolicy(deps, "chat-1")
    expect(result).toBe(POLICY_DEFAULT)
  })

  test("returns base chatPolicy when chat has no policyOverride", () => {
    const deps = makeDeps({
      store: {
        state: {
          chatsById: new Map([["chat-1", { policyOverride: null }]]),
        },
      },
    })
    const result = resolveChatPolicy(deps, "chat-1")
    expect(result).toEqual(POLICY_DEFAULT)
  })

  test("applies policyOverride when present", () => {
    const override = { defaultAction: "auto-allow" as const }
    const deps = makeDeps({
      store: {
        state: {
          chatsById: new Map([["chat-1", { policyOverride: override }]]),
        },
      },
    })
    const result = resolveChatPolicy(deps, "chat-1")
    expect(result.defaultAction).toBe("auto-allow")
  })

  test("falls back to base policy when chat id not in store", () => {
    const deps = makeDeps({
      store: {
        state: { chatsById: new Map() },
      },
    })
    const result = resolveChatPolicy(deps, "nonexistent")
    expect(result).toEqual(POLICY_DEFAULT)
  })
})

// ---------------------------------------------------------------------------
// killPtyInstance
// ---------------------------------------------------------------------------

describe("killPtyInstance", () => {
  test("throws when no PTY instance found for chat", async () => {
    const deps = makeDeps({
      ptyInstanceRegistry: {
        snapshot: () => [],
        markExitedIfCurrent: () => {},
      },
    })
    await expect(killPtyInstance(deps, "chat-1")).rejects.toThrow("No live PTY instance for chat")
  })

  test("throws when PTY instance has no pid", async () => {
    const deps = makeDeps({
      ptyInstanceRegistry: {
        snapshot: () => [{ chatId: "chat-1", pid: null }],
        markExitedIfCurrent: () => {},
      },
    })
    await expect(killPtyInstance(deps, "chat-1")).rejects.toThrow("No live PTY instance for chat")
  })

  test("calls killProcessTree with the instance pid", async () => {
    const killed: number[] = []
    const deps = makeDeps({
      ptyInstanceRegistry: {
        snapshot: () => [{ chatId: "chat-1", pid: 42 }],
        markExitedIfCurrent: () => {},
      },
      killProcessTree: async (pid) => { killed.push(pid) },
    })
    await killPtyInstance(deps, "chat-1")
    expect(killed).toEqual([42])
  })

  test("calls markExitedIfCurrent after killProcessTree", async () => {
    const marked: Array<{ chatId: string; pid: number }> = []
    const deps = makeDeps({
      ptyInstanceRegistry: {
        snapshot: () => [{ chatId: "chat-1", pid: 99 }],
        markExitedIfCurrent: (chatId, pid) => { marked.push({ chatId, pid }) },
      },
    })
    await killPtyInstance(deps, "chat-1")
    expect(marked).toHaveLength(1)
    expect(marked[0]).toMatchObject({ chatId: "chat-1", pid: 99 })
  })
})
