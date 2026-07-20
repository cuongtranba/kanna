import type { AnyValue } from "../shared/errors"
import { log } from "../shared/log"
import type { ClientCommand } from "../shared/protocol"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  KeybindingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  McpServerConfig,
  OpenRouterModel,
  Subagent,
  SubagentInput,
  SubagentPatch,
  SubagentValidationError,
} from "../shared/types"
import { fetchGitHubReleases } from "./diff-store"
import { validateMcpServer } from "./mcp-validator"
import { completeMcpOAuth, ensureFreshMcpToken, startMcpOAuth } from "./mcp-oauth.adapter"

export function isSubagentValidationError(value: Subagent | SubagentValidationError): value is SubagentValidationError {
  return "code" in value && "message" in value
}

export async function testOAuthToken(token: string): Promise<{ ok: boolean; error: string | null }> {
  const trimmed = typeof token === "string" ? token.trim() : ""
  if (!trimmed) return { ok: false, error: "Token is empty" }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "authorization": `Bearer ${trimmed}`,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Unauthorized" }
    if (res.status === 429) return { ok: true, error: "Token valid but currently rate-limited" }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: "Request timed out after 10s" }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * For an OAuth-authenticated network server, resolve a fresh access token to
 * inject as a Bearer when probing it — the manual "Test" / auto-test path is
 * otherwise tokenless and a healthy OAuth server 401s. Returns undefined for
 * stdio, static-header, or not-yet-authenticated servers (the probe runs with
 * stored headers only). A refresh failure also yields undefined, so the probe
 * surfaces the unauthorized error that correctly signals re-auth is needed.
 */
export async function resolveMcpTestBearer(
  entry: McpServerConfig,
  appSettings: { writePatch(p: AppSettingsPatch): Promise<unknown> },
): Promise<string | undefined> {
  if (entry.transport === "stdio" || entry.oauth?.status !== "authenticated") return undefined
  try {
    return await ensureFreshMcpToken(entry, {
      persist: (oauth) =>
        void appSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
    })
  } catch {
    return undefined
  }
}

async function runMcpAutoTest(
  id: string,
  appSettings: { getSnapshot(): AppSettingsSnapshot; writePatch(p: AppSettingsPatch): Promise<unknown> },
): Promise<void> {
  try {
    const entry = appSettings.getSnapshot().customMcpServers.find((s) => s.id === id)
    if (!entry) return
    await appSettings.writePatch({
      customMcpServers: {
        setTestResult: { id, result: { status: "pending", startedAt: new Date().toISOString() } },
      },
    })
    const bearer = await resolveMcpTestBearer(entry, appSettings)
    const result = await validateMcpServer(entry, bearer ? { bearer } : {})
    await appSettings.writePatch({ customMcpServers: { setTestResult: { id, result } } })
  } catch (err) {
    log.warn("[kanna/ws-router] runMcpAutoTest failed", String(err))
  }
}

export type SettingsCommandContext = {
  ack: (result?: AnyValue) => void
  keybindings: {
    getSnapshot(): KeybindingsSnapshot
    write(bindings: Record<string, string[]>): Promise<KeybindingsSnapshot>
  }
  appSettings: {
    getSnapshot(): AppSettingsSnapshot
    write(value: { analyticsEnabled: boolean }): Promise<AppSettingsSnapshot>
    writePatch(patch: AppSettingsPatch): Promise<AppSettingsSnapshot>
    setCloudflareTunnel(patch: Partial<AppSettingsSnapshot["cloudflareTunnel"]>): Promise<AppSettingsSnapshot>
    setClaudeAuth(patch: Partial<AppSettingsSnapshot["claudeAuth"]>): Promise<AppSettingsSnapshot>
    createSubagent(input: SubagentInput): Promise<Subagent | SubagentValidationError>
    updateSubagent(id: string, patch: SubagentPatch): Promise<Subagent | SubagentValidationError>
    deleteSubagent(id: string): Promise<void>
  }
  analytics: { track(event: string): void }
  llmProvider: {
    read(): Promise<LlmProviderSnapshot>
    write(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderSnapshot>
    validate(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderValidationResult>
  }
  listOpenRouterModels?: () => Promise<OpenRouterModel[]>
}

export async function handleSettingsCommand(command: ClientCommand, ctx: SettingsCommandContext): Promise<boolean> {
  switch (command.type) {
    case "settings.readKeybindings": {
      ctx.ack(ctx.keybindings.getSnapshot())
      return true
    }
    case "settings.writeKeybindings": {
      const snapshot = await ctx.keybindings.write(command.bindings)
      ctx.ack(snapshot)
      return true
    }
    case "settings.readAppSettings": {
      ctx.ack(ctx.appSettings.getSnapshot())
      return true
    }
    case "settings.writeAppSettings": {
      const prev = ctx.appSettings.getSnapshot().analyticsEnabled
      if (prev && !command.analyticsEnabled) ctx.analytics.track("analytics_disabled")
      const snapshot = await ctx.appSettings.write({ analyticsEnabled: command.analyticsEnabled })
      ctx.ack(snapshot)
      if (!prev && command.analyticsEnabled) ctx.analytics.track("analytics_enabled")
      return true
    }
    case "appSettings.setCloudflareTunnel": {
      await ctx.appSettings.setCloudflareTunnel(command.patch)
      ctx.ack(ctx.appSettings.getSnapshot())
      return true
    }
    case "appSettings.setClaudeAuth": {
      await ctx.appSettings.setClaudeAuth(command.patch)
      ctx.ack(ctx.appSettings.getSnapshot())
      return true
    }
    case "appSettings.testOAuthToken": {
      ctx.ack(await testOAuthToken(command.token))
      return true
    }
    case "settings.writeAppSettingsPatch": {
      const prev = ctx.appSettings.getSnapshot().analyticsEnabled
      const snapshot = await ctx.appSettings.writePatch(command.patch)
      ctx.ack(snapshot)

      const targetId = (() => {
        const ops = command.patch.customMcpServers
        if (!ops) return null
        if (ops.update) return ops.update.id
        if (ops.create) {
          const list = snapshot.customMcpServers
          if (list.length === 0) return null
          return list.reduce((latest, e) => (e.createdAt > latest.createdAt ? e : latest), list[0]!).id
        }
        return null
      })()
      if (targetId) {
        void runMcpAutoTest(targetId, ctx.appSettings)
      }

      if (command.patch.analyticsEnabled !== undefined && prev && !snapshot.analyticsEnabled) {
        ctx.analytics.track("analytics_disabled")
      }
      if (command.patch.analyticsEnabled !== undefined && !prev && snapshot.analyticsEnabled) {
        ctx.analytics.track("analytics_enabled")
      }
      return true
    }
    case "subagent.create": {
      const result = await ctx.appSettings.createSubagent(command.input)
      ctx.ack(isSubagentValidationError(result) ? { ok: false, error: result } : { ok: true, subagent: result })
      return true
    }
    case "subagent.update": {
      const result = await ctx.appSettings.updateSubagent(command.id, command.patch)
      ctx.ack(isSubagentValidationError(result) ? { ok: false, error: result } : { ok: true, subagent: result })
      return true
    }
    case "subagent.delete": {
      await ctx.appSettings.deleteSubagent(command.id)
      ctx.ack({ ok: true })
      return true
    }
    case "settings.testMcpServer": {
      const entry = ctx.appSettings.getSnapshot().customMcpServers.find((s) => s.id === command.id)
      if (!entry) {
        ctx.ack({
          ok: false,
          message: "MCP server not found",
          lastTest: { status: "error", testedAt: new Date().toISOString(), message: "not found" } as const,
        })
        return true
      }
      await ctx.appSettings.writePatch({
        customMcpServers: {
          setTestResult: { id: entry.id, result: { status: "pending", startedAt: new Date().toISOString() } },
        },
      })
      const testBearer = await resolveMcpTestBearer(entry, ctx.appSettings)
      const lastTest = await validateMcpServer(entry, testBearer ? { bearer: testBearer } : {})
      await ctx.appSettings.writePatch({
        customMcpServers: { setTestResult: { id: entry.id, result: lastTest } },
      })
      ctx.ack({
        ok: lastTest.status === "ok",
        message: lastTest.status === "error" ? lastTest.message : undefined,
        lastTest,
      })
      return true
    }
    case "settings.startMcpOAuth": {
      const entry = ctx.appSettings.getSnapshot().customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        ctx.ack({ ok: false, error: "not found or unsupported transport" })
        return true
      }
      try {
        const result = await startMcpOAuth(entry, {
          persist: (oauth) => void ctx.appSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
        })
        ctx.ack(result.kind === "authorizationUrl"
          ? { ok: true, authorizationUrl: result.authorizationUrl }
          : { ok: true, alreadyAuthenticated: true })
      } catch (err) {
        ctx.ack({ ok: false, error: err instanceof Error ? err.message : "oauth start failed" })
      }
      return true
    }
    case "settings.completeMcpOAuth": {
      const entry = ctx.appSettings.getSnapshot().customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        ctx.ack({ ok: false, error: "not found" })
        return true
      }
      try {
        const result = await completeMcpOAuth(entry, command.callbackUrl, {
          persist: (oauth) => void ctx.appSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
          listTools: async (_serverUrl, accessToken) => {
            const r = await validateMcpServer(entry, { bearer: accessToken })
            return r.status === "ok" ? r.toolCount : 0
          },
        })
        ctx.ack({ ok: true, testResult: result })
      } catch (err) {
        ctx.ack({ ok: false, error: err instanceof Error ? err.message : "oauth complete failed" })
      }
      return true
    }
    case "settings.readLlmProvider": {
      ctx.ack(await ctx.llmProvider.read())
      return true
    }
    case "settings.listOpenRouterModels": {
      ctx.ack(ctx.listOpenRouterModels ? await ctx.listOpenRouterModels() : [])
      return true
    }
    case "settings.getChangelog": {
      ctx.ack(await fetchGitHubReleases("cuongtranba/kanna"))
      return true
    }
    case "settings.writeLlmProvider": {
      ctx.ack(await ctx.llmProvider.write({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      }))
      return true
    }
    case "settings.validateLlmProvider": {
      ctx.ack(await ctx.llmProvider.validate({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      }))
      return true
    }
    default:
      return false
  }
}
