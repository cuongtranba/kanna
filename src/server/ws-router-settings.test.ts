import { describe, expect, mock, test } from "bun:test"
import { AUTH_DEFAULTS, CLAUDE_AUTH_DEFAULTS, CLAUDE_DRIVER_DEFAULTS, CLAUDE_PTY_LIFECYCLE_DEFAULTS, CLOUDFLARE_TUNNEL_DEFAULTS, DEFAULT_KEYBINDINGS, DEFAULT_OPENROUTER_SDK_MODEL, UPLOAD_DEFAULTS } from "../shared/types"
import type { AppSettingsSnapshot, KeybindingsSnapshot, McpServerConfig, OpenRouterModel } from "../shared/types"
import { handleSettingsCommand, resolveMcpTestBearer, testOAuthToken } from "./ws-router-settings"

const DEFAULT_KEYBINDINGS_SNAPSHOT: KeybindingsSnapshot = {
  bindings: DEFAULT_KEYBINDINGS,
  warning: null,
  filePathDisplay: "~/.kanna/keybindings.json",
}

const DEFAULT_APP_SETTINGS_SNAPSHOT: AppSettingsSnapshot = {
  analyticsEnabled: true,
  cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
  auth: AUTH_DEFAULTS,
  claudeAuth: CLAUDE_AUTH_DEFAULTS,
  browserSettingsMigrated: false,
  theme: "system",
  chatSoundPreference: "always",
  chatSoundId: "funk",
  terminal: {
    scrollbackLines: 1_000,
    minColumnWidth: 450,
  },
  editor: {
    preset: "cursor",
    commandTemplate: "cursor {path}",
  },
  defaultProvider: "last_used",
  providerDefaults: {
    claude: {
      model: "claude-opus-4-7",
      modelOptions: {
        reasoningEffort: "high",
        contextWindow: "200k",
      },
      planMode: false,
    },
    codex: {
      model: "gpt-5.5",
      modelOptions: {
        reasoningEffort: "high",
        fastMode: false,
      },
      planMode: false,
    },
    openrouter: {
      model: DEFAULT_OPENROUTER_SDK_MODEL,
      modelOptions: {},
      planMode: false,
    },
  },
  warning: null,
  filePathDisplay: "~/.kanna/data/settings.json",
  uploads: UPLOAD_DEFAULTS,
  subagents: [],
  customMcpServers: [],
  customModels: [],
  textSnippets: [],
  claudeDriver: { ...CLAUDE_DRIVER_DEFAULTS, lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS } },
  globalPromptAppend: "",
  shareDefaultTtlHours: 24,
  subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: null },
}

describe("testOAuthToken", () => {
  test("returns error for empty token", async () => {
    const result = await testOAuthToken("")
    expect(result).toEqual({ ok: false, error: "Token is empty" })
  })

  test("returns error for whitespace-only token", async () => {
    const result = await testOAuthToken("   ")
    expect(result).toEqual({ ok: false, error: "Token is empty" })
  })
})

describe("resolveMcpTestBearer", () => {
  const noopAppSettings = { writePatch: async () => ({}) }

  function authedHttp(): McpServerConfig {
    return {
      id: "h",
      name: "design",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastTest: { status: "untested" },
      transport: "http",
      url: "https://api.example/mcp",
      headers: {},
      oauth: {
        enabled: true,
        status: "authenticated",
        tokens: { access_token: "tok-123", token_type: "Bearer" },
      },
    }
  }

  test("returns the access token for an authenticated oauth server", async () => {
    expect(await resolveMcpTestBearer(authedHttp(), noopAppSettings)).toBe("tok-123")
  })

  test("returns undefined for a stdio server", async () => {
    const entry: McpServerConfig = {
      id: "s",
      name: "s",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastTest: { status: "untested" },
      transport: "stdio",
      command: "x",
      args: [],
      env: {},
    }
    expect(await resolveMcpTestBearer(entry, noopAppSettings)).toBeUndefined()
  })

  test("returns undefined for an unauthenticated oauth server", async () => {
    const entry = { ...authedHttp(), oauth: { enabled: true, status: "unauthenticated" as const } }
    expect(await resolveMcpTestBearer(entry, noopAppSettings)).toBeUndefined()
  })
})

describe("handleSettingsCommand", () => {
  function makeCtx(overrides: Partial<Parameters<typeof handleSettingsCommand>[1]> = {}) {
    const acked: unknown[] = []
    const tracked: string[] = []
    return {
      ctx: {
        ack: (result?: unknown) => { acked.push(result) },
        keybindings: {
          getSnapshot: () => DEFAULT_KEYBINDINGS_SNAPSHOT,
          write: async () => DEFAULT_KEYBINDINGS_SNAPSHOT,
        },
        appSettings: {
          getSnapshot: () => ({ ...DEFAULT_APP_SETTINGS_SNAPSHOT, analyticsEnabled: false }),
          write: async (v: { analyticsEnabled: boolean }) => ({ ...DEFAULT_APP_SETTINGS_SNAPSHOT, analyticsEnabled: v.analyticsEnabled }),
          writePatch: async () => DEFAULT_APP_SETTINGS_SNAPSHOT,
          setCloudflareTunnel: async () => DEFAULT_APP_SETTINGS_SNAPSHOT,
          setClaudeAuth: async () => DEFAULT_APP_SETTINGS_SNAPSHOT,
          createSubagent: async () => ({ code: "NOT_FOUND" as const, message: "stub" }),
          updateSubagent: async () => ({ code: "NOT_FOUND" as const, message: "stub" }),
          deleteSubagent: async () => {},
        },
        analytics: { track: (e: string) => { tracked.push(e) } },
        llmProvider: {
          read: async () => ({}) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["llmProvider"]["read"]>,
          write: async () => ({}) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["llmProvider"]["write"]>,
          validate: async () => ({}) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["llmProvider"]["validate"]>,
        },
        listOpenRouterModels: undefined,
        ...overrides,
      } satisfies Parameters<typeof handleSettingsCommand>[1],
      acked,
      tracked,
    }
  }

  test("returns false for unrecognized command type", async () => {
    const { ctx } = makeCtx()
    const handled = await handleSettingsCommand({ type: "system.ping" } as Parameters<typeof handleSettingsCommand>[0], ctx)
    expect(handled).toBe(false)
  })

  test("settings.readKeybindings calls ack with keybindings snapshot", async () => {
    const { ctx, acked } = makeCtx()
    const handled = await handleSettingsCommand({ type: "settings.readKeybindings" }, ctx)
    expect(handled).toBe(true)
    expect(acked).toHaveLength(1)
    expect(acked[0]).toMatchObject({ bindings: {} })
  })

  test("settings.readAppSettings calls ack with app settings snapshot", async () => {
    const { ctx, acked } = makeCtx()
    const handled = await handleSettingsCommand({ type: "settings.readAppSettings" }, ctx)
    expect(handled).toBe(true)
    expect(acked).toHaveLength(1)
  })

  test("settings.listOpenRouterModels returns empty array when not configured", async () => {
    const { ctx, acked } = makeCtx()
    const handled = await handleSettingsCommand({ type: "settings.listOpenRouterModels" }, ctx)
    expect(handled).toBe(true)
    expect(acked[0]).toEqual([])
  })

  test("settings.listOpenRouterModels calls the provider when configured", async () => {
    const models: OpenRouterModel[] = [{ id: "m1", label: "m1", contextLength: 0 }]
    const { ctx, acked } = makeCtx({ listOpenRouterModels: async () => models })
    const handled = await handleSettingsCommand({ type: "settings.listOpenRouterModels" }, ctx)
    expect(handled).toBe(true)
    expect(acked[0]).toBe(models)
  })

  test("settings.writeAppSettings tracks analytics_disabled when disabling", async () => {
    const getSnapshot = mock(() => ({ ...DEFAULT_APP_SETTINGS_SNAPSHOT, analyticsEnabled: true }))
    const { ctx, tracked } = makeCtx({
      appSettings: {
        ...makeCtx().ctx.appSettings,
        getSnapshot,
      },
    })
    await handleSettingsCommand({ type: "settings.writeAppSettings", analyticsEnabled: false }, ctx)
    expect(tracked).toContain("analytics_disabled")
    expect(tracked).not.toContain("analytics_enabled")
  })

  test("settings.writeAppSettings tracks analytics_enabled when enabling", async () => {
    const { ctx, tracked } = makeCtx()
    await handleSettingsCommand({ type: "settings.writeAppSettings", analyticsEnabled: true }, ctx)
    expect(tracked).toContain("analytics_enabled")
    expect(tracked).not.toContain("analytics_disabled")
  })

  test("subagent.delete calls ack with ok:true", async () => {
    const { ctx, acked } = makeCtx()
    const handled = await handleSettingsCommand({ type: "subagent.delete", id: "sub-1" }, ctx)
    expect(handled).toBe(true)
    expect(acked[0]).toEqual({ ok: true })
  })
})
