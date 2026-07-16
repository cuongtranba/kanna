import { describe, expect, mock, test } from "bun:test"
import type { McpServerConfig } from "../shared/types"
import { handleSettingsCommand, resolveMcpTestBearer, testOAuthToken } from "./ws-router-settings"

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
          getSnapshot: () => ({ bindings: {} as Record<string, string[]> }),
          write: async (bindings: Record<string, string[]>) => ({ bindings }),
        },
        appSettings: {
          getSnapshot: () => ({
            analyticsEnabled: false,
            customMcpServers: [],
            subagents: [],
          }) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["getSnapshot"]>,
          write: async (v: { analyticsEnabled: boolean }) => ({ analyticsEnabled: v.analyticsEnabled }) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["write"]>,
          writePatch: async () => ({ analyticsEnabled: false, customMcpServers: [], subagents: [] }) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["writePatch"]>,
          setCloudflareTunnel: async () => ({}) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["setCloudflareTunnel"]>,
          setClaudeAuth: async () => ({}) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["setClaudeAuth"]>,
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
    const models = [{ id: "m1" }]
    const { ctx, acked } = makeCtx({ listOpenRouterModels: async () => models as ReturnType<NonNullable<Parameters<typeof handleSettingsCommand>[1]["listOpenRouterModels"]>> })
    const handled = await handleSettingsCommand({ type: "settings.listOpenRouterModels" }, ctx)
    expect(handled).toBe(true)
    expect(acked[0]).toBe(models)
  })

  test("settings.writeAppSettings tracks analytics_disabled when disabling", async () => {
    const getSnapshot = mock(() => ({
      analyticsEnabled: true,
      customMcpServers: [],
      subagents: [],
    }) as ReturnType<Parameters<typeof handleSettingsCommand>[1]["appSettings"]["getSnapshot"]>)
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
