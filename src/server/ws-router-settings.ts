/**
 * ws-router-settings.ts
 *
 * Command handlers for the settings, subagent, MCP, LLM-provider, and
 * skills command groups extracted from ws-router.ts.  No closure
 * dependencies on createWsRouter's local variables — every dep is injected
 * via SettingsCommandDeps, making these handlers testable in isolation.
 *
 * Covers: settings.*, appSettings.*, subagent.*, settings.testMcpServer,
 *   settings.startMcpOAuth, settings.completeMcpOAuth, settings.*LlmProvider,
 *   settings.getChangelog, skills.*
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  McpServerConfig,
  OpenRouterModel,
  Subagent,
  SubagentInput,
  SubagentPatch,
  SubagentValidationError,
} from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { AnalyticsReporter } from "./analytics"
import { KeybindingsManager } from "./keybindings"
import { validateMcpServer } from "./mcp-validator"
import { startMcpOAuth, completeMcpOAuth, ensureFreshMcpToken } from "./mcp-oauth.adapter"
import { fetchGitHubReleases } from "./diff-store"
import { log } from "../shared/log"
import {
  searchSkills,
  installSkill,
  uninstallSkill,
  listInstalledSkills,
} from "./ws-router-skills"

// ---------------------------------------------------------------------------
// Dep interfaces (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

export interface ResolvedAppSettings {
  getSnapshot(): AppSettingsSnapshot
  write(value: { analyticsEnabled: boolean }): Promise<AppSettingsSnapshot>
  writePatch(patch: AppSettingsPatch): Promise<AppSettingsSnapshot>
  setCloudflareTunnel(patch: Partial<AppSettingsSnapshot["cloudflareTunnel"]>): Promise<AppSettingsSnapshot>
  setClaudeAuth(patch: Partial<AppSettingsSnapshot["claudeAuth"]>): Promise<AppSettingsSnapshot>
  createSubagent(input: SubagentInput): Promise<Subagent | SubagentValidationError>
  updateSubagent(id: string, patch: SubagentPatch): Promise<Subagent | SubagentValidationError>
  deleteSubagent(id: string): Promise<void>
}

export interface ResolvedLlmProvider {
  read(): Promise<LlmProviderSnapshot>
  write(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderSnapshot>
  validate(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderValidationResult>
}

export interface SettingsCommandDeps {
  keybindings: KeybindingsManager
  resolvedAppSettings: ResolvedAppSettings
  resolvedAnalytics: Pick<AnalyticsReporter, "track">
  resolvedLlmProvider: ResolvedLlmProvider
  listOpenRouterModels: (() => Promise<OpenRouterModel[]>) | undefined
  /** Pre-bound to the current WebSocket; called to ack the command. */
  send: (envelope: ServerEnvelope) => void
}

// ---------------------------------------------------------------------------
// Internal helpers (previously at the bottom of ws-router.ts)
// ---------------------------------------------------------------------------

export function isSubagentValidationError(
  value: Subagent | SubagentValidationError,
): value is SubagentValidationError {
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
 * otherwise tokenless and a healthy OAuth server 401s.  Returns undefined for
 * stdio, static-header, or not-yet-authenticated servers (the probe runs with
 * stored headers only).  A refresh failure also yields undefined, so the probe
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

export async function runMcpAutoTest(
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
    // Auto-test must never throw; log + swallow.
    log.warn("[kanna/ws-router] runMcpAutoTest failed", String(err))
  }
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one settings-domain WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type falls outside this module's scope
 * (should not happen in practice once all cases are wired up, but keeps the
 * type-system honest).
 */
export async function handleSettingsCommand(
  deps: SettingsCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { keybindings, resolvedAppSettings, resolvedAnalytics, resolvedLlmProvider, listOpenRouterModels, send } = deps

  switch (command.type) {
    case "settings.readKeybindings": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: keybindings.getSnapshot() })
      return true
    }
    case "settings.writeKeybindings": {
      const snapshot = await keybindings.write(command.bindings)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "settings.readAppSettings": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: resolvedAppSettings.getSnapshot() })
      return true
    }
    case "settings.writeAppSettings": {
      const previousAnalyticsEnabled = resolvedAppSettings.getSnapshot().analyticsEnabled
      if (previousAnalyticsEnabled && !command.analyticsEnabled) {
        resolvedAnalytics.track("analytics_disabled")
      }
      const snapshot = await resolvedAppSettings.write({ analyticsEnabled: command.analyticsEnabled })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      if (!previousAnalyticsEnabled && command.analyticsEnabled) {
        resolvedAnalytics.track("analytics_enabled")
      }
      return true
    }
    case "appSettings.setCloudflareTunnel": {
      await resolvedAppSettings.setCloudflareTunnel(command.patch)
      const snapshot = resolvedAppSettings.getSnapshot()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "appSettings.setClaudeAuth": {
      await resolvedAppSettings.setClaudeAuth(command.patch)
      const snapshot = resolvedAppSettings.getSnapshot()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "appSettings.testOAuthToken": {
      const result = await testOAuthToken(command.token)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "settings.writeAppSettingsPatch": {
      const previousAnalyticsEnabled = resolvedAppSettings.getSnapshot().analyticsEnabled
      const snapshot = await resolvedAppSettings.writePatch(command.patch)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })

      // Fire-and-forget auto-test for newly created or updated MCP server.
      const targetId = (() => {
        const ops = command.patch.customMcpServers
        if (!ops) return null
        if (ops.update) return ops.update.id
        if (ops.create) {
          // The created entry is the one with no prior match by name —
          // simplest: pick the entry with the latest createdAt.
          const list = snapshot.customMcpServers
          if (list.length === 0) return null
          return list.reduce((latest, e) => (e.createdAt > latest.createdAt ? e : latest), list[0]!).id
        }
        return null
      })()
      if (targetId) {
        void runMcpAutoTest(targetId, resolvedAppSettings)
      }

      if (command.patch.analyticsEnabled !== undefined && previousAnalyticsEnabled && !snapshot.analyticsEnabled) {
        resolvedAnalytics.track("analytics_disabled")
      }
      if (command.patch.analyticsEnabled !== undefined && !previousAnalyticsEnabled && snapshot.analyticsEnabled) {
        resolvedAnalytics.track("analytics_enabled")
      }
      return true
    }
    case "subagent.create": {
      const result = await resolvedAppSettings.createSubagent(command.input)
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: isSubagentValidationError(result)
          ? { ok: false, error: result }
          : { ok: true, subagent: result },
      })
      return true
    }
    case "subagent.update": {
      const result = await resolvedAppSettings.updateSubagent(command.id, command.patch)
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: isSubagentValidationError(result)
          ? { ok: false, error: result }
          : { ok: true, subagent: result },
      })
      return true
    }
    case "subagent.delete": {
      await resolvedAppSettings.deleteSubagent(command.id)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true } })
      return true
    }
    case "settings.testMcpServer": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry) {
        send({
          v: PROTOCOL_VERSION,
          type: "ack",
          id,
          result: {
            ok: false,
            message: "MCP server not found",
            lastTest: { status: "error", testedAt: new Date().toISOString(), message: "not found" } as const,
          },
        })
        return true
      }
      // Mark pending so the UI sees a spinner while we connect.
      await resolvedAppSettings.writePatch({
        customMcpServers: {
          setTestResult: { id: entry.id, result: { status: "pending", startedAt: new Date().toISOString() } },
        },
      })
      const testBearer = await resolveMcpTestBearer(entry, resolvedAppSettings)
      const lastTest = await validateMcpServer(entry, testBearer ? { bearer: testBearer } : {})
      await resolvedAppSettings.writePatch({
        customMcpServers: { setTestResult: { id: entry.id, result: lastTest } },
      })
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: {
          ok: lastTest.status === "ok",
          message: lastTest.status === "error" ? lastTest.message : undefined,
          lastTest,
        },
      })
      return true
    }
    case "settings.startMcpOAuth": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: "not found or unsupported transport" } })
        return true
      }
      try {
        const result = await startMcpOAuth(entry, {
          persist: (oauth) => void resolvedAppSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
        })
        send({
          v: PROTOCOL_VERSION, type: "ack", id,
          result: result.kind === "authorizationUrl"
            ? { ok: true, authorizationUrl: result.authorizationUrl }
            : { ok: true, alreadyAuthenticated: true },
        })
      } catch (err) {
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: err instanceof Error ? err.message : "oauth start failed" } })
      }
      return true
    }
    case "settings.completeMcpOAuth": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: "not found" } })
        return true
      }
      try {
        const result = await completeMcpOAuth(entry, command.callbackUrl, {
          persist: (oauth) => void resolvedAppSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
          listTools: async (_serverUrl, accessToken) => {
            const r = await validateMcpServer(entry, { bearer: accessToken })
            return r.status === "ok" ? r.toolCount : 0
          },
        })
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true, testResult: result } })
      } catch (err) {
        send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: false, error: err instanceof Error ? err.message : "oauth complete failed" } })
      }
      return true
    }
    case "settings.readLlmProvider": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: await resolvedLlmProvider.read() })
      return true
    }
    case "settings.listOpenRouterModels": {
      const models = listOpenRouterModels ? await listOpenRouterModels() : []
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: models })
      return true
    }
    case "settings.getChangelog": {
      const releases = await fetchGitHubReleases("cuongtranba/kanna")
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: releases })
      return true
    }
    case "settings.writeLlmProvider": {
      const snapshot = await resolvedLlmProvider.write({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "settings.validateLlmProvider": {
      const result = await resolvedLlmProvider.validate({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "skills.search": {
      const snapshot = await searchSkills(command.query, command.limit)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: snapshot })
      return true
    }
    case "skills.install": {
      const result = await installSkill(command.source, command.skillId)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "skills.uninstall": {
      const result = await uninstallSkill(command.skillId)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "skills.listInstalled": {
      const result = await listInstalledSkills()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    default:
      return false
  }
}
