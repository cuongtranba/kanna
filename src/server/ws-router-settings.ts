import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  OpenRouterModel,
  Subagent,
  SubagentValidationError,
} from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { AnalyticsReporter } from "./analytics"
import { KeybindingsManager } from "./keybindings"
import { ackResult } from "./ws-router-ack"
import type { BeaconMintResult, BeaconUpdateResult } from "../shared/beacon-config"
import { getBeaconPairingStore } from "./beacon-pairing-host"
import type { BeaconRegistry } from "./beacon-registry"
import { validateMcpServer } from "./mcp-validator"
import { testMcpServer } from "./mcp-server-test"
import { testOAuthToken } from "./claude-oauth-probe.adapter"
import { startMcpOAuth, completeMcpOAuth } from "./mcp-oauth.adapter"
import { fetchGitHubReleases } from "./diff-store"
import { log } from "../shared/log"
import {
  searchSkills,
  installSkill,
  uninstallSkill,
  listInstalledSkills,
} from "./ws-router-skills"
import { readPackageInventory } from "./package-inventory-io.adapter"
import type { PackageUpdateManager } from "./package-update-manager"
import type { ResolvedAppSettings } from "./ws-router-defaults"

export { resolveMcpBearer as resolveMcpTestBearer } from "./mcp-bearer"

export interface ResolvedLlmProvider {
  read(): Promise<LlmProviderSnapshot>
  write(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderSnapshot>
  validate(value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">): Promise<LlmProviderValidationResult>
}

export interface SettingsCommandDeps {
  keybindings: KeybindingsManager
  resolvedAppSettings: Omit<ResolvedAppSettings, "onChange">
  resolvedAnalytics: Pick<AnalyticsReporter, "track">
  resolvedLlmProvider: ResolvedLlmProvider
  listOpenRouterModels: (() => Promise<OpenRouterModel[]>) | undefined
  packageUpdateManager?: PackageUpdateManager
  beaconRegistry?: Pick<BeaconRegistry, "requestUpdate">
  authEnabled?: boolean
  send: (envelope: ServerEnvelope) => void
}

const BEACONS_UNAVAILABLE = "Beacons are not available on this server."


export function isSubagentValidationError(
  value: Subagent | SubagentValidationError,
): value is SubagentValidationError {
  return "code" in value && "message" in value
}

export async function runMcpAutoTest<TWriteResult>(
  id: string,
  appSettings: { getSnapshot(): AppSettingsSnapshot; writePatch(p: AppSettingsPatch): Promise<TWriteResult> },
): Promise<void> {
  try {
    const entry = appSettings.getSnapshot().customMcpServers.find((s) => s.id === id)
    if (!entry) return
    await testMcpServer(entry, appSettings)
  } catch (err) {
    log.warn("[kanna/ws-router] runMcpAutoTest failed", String(err))
  }
}

async function writeTrackingAnalytics<TResult>(
  nextEnabled: boolean | undefined,
  settings: Pick<ResolvedAppSettings, "getSnapshot">,
  analytics: Pick<AnalyticsReporter, "track">,
  write: () => Promise<TResult>,
): Promise<TResult> {
  const wasEnabled = settings.getSnapshot().analyticsEnabled
  if (nextEnabled === false && wasEnabled) analytics.track("analytics_disabled")
  const result = await write()
  if (nextEnabled === true && !wasEnabled) analytics.track("analytics_enabled")
  return result
}


export async function handleSettingsCommand(
  deps: SettingsCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { keybindings, resolvedAppSettings, resolvedAnalytics, resolvedLlmProvider, listOpenRouterModels, packageUpdateManager, beaconRegistry, authEnabled, send } = deps

  switch (command.type) {
    case "settings.readKeybindings": {
      send(ackResult(id, command, keybindings.getSnapshot()))
      return true
    }
    case "settings.writeKeybindings": {
      const snapshot = await keybindings.write(command.bindings)
      send(ackResult(id, command, snapshot))
      return true
    }
    case "settings.readAppSettings": {
      send(ackResult(id, command, resolvedAppSettings.getSnapshot()))
      return true
    }
    case "settings.writeAppSettings": {
      const snapshot = await writeTrackingAnalytics(
        command.analyticsEnabled,
        resolvedAppSettings,
        resolvedAnalytics,
        () => resolvedAppSettings.write({ analyticsEnabled: command.analyticsEnabled }),
      )
      send(ackResult(id, command, snapshot))
      return true
    }
    case "appSettings.setCloudflareTunnel": {
      await resolvedAppSettings.setCloudflareTunnel(command.patch)
      const snapshot = resolvedAppSettings.getSnapshot()
      send(ackResult(id, command, snapshot))
      return true
    }
    case "appSettings.setClaudeAuth": {
      await resolvedAppSettings.setClaudeAuth(command.patch)
      const snapshot = resolvedAppSettings.getSnapshot()
      send(ackResult(id, command, snapshot))
      return true
    }
    case "appSettings.testOAuthToken": {
      const result = await testOAuthToken(command.token, command.baseUrl)
      send(ackResult(id, command, result))
      return true
    }
    case "settings.writeAppSettingsPatch": {
      const snapshot = await writeTrackingAnalytics(
        command.patch.analyticsEnabled,
        resolvedAppSettings,
        resolvedAnalytics,
        () => resolvedAppSettings.writePatch(command.patch),
      )
      send(ackResult(id, command, snapshot))

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
        void runMcpAutoTest(targetId, resolvedAppSettings)
      }

      return true
    }
    case "subagent.create": {
      const result = await resolvedAppSettings.createSubagent(command.input)
      send(ackResult(id, command, isSubagentValidationError(result)
        ? { ok: false, error: result }
        : { ok: true, subagent: result }))
      return true
    }
    case "subagent.update": {
      const result = await resolvedAppSettings.updateSubagent(command.id, command.patch)
      send(ackResult(id, command, isSubagentValidationError(result)
        ? { ok: false, error: result }
        : { ok: true, subagent: result }))
      return true
    }
    case "subagent.delete": {
      await resolvedAppSettings.deleteSubagent(command.id)
      send(ackResult(id, command, { ok: true }))
      return true
    }
    case "settings.testMcpServer": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry) {
        send(ackResult(id, command, {
          ok: false,
          message: "MCP server not found",
          lastTest: { status: "error", testedAt: new Date().toISOString(), message: "not found" },
        }))
        return true
      }
      const lastTest = await testMcpServer(entry, resolvedAppSettings)
      send(ackResult(id, command, {
        ok: lastTest.status === "ok",
        message: lastTest.status === "error" ? lastTest.message : undefined,
        lastTest,
      }))
      return true
    }
    case "beacons.mintPairingCode": {
      const minted: BeaconMintResult = authEnabled
        ? { ok: true, ...getBeaconPairingStore().mint() }
        : { ok: false, error: "Pairing a beacon requires a server password. Start Kanna with --password." }
      send(ackResult(id, command, minted))
      return true
    }
    case "beacons.update": {
      const requested: BeaconUpdateResult = beaconRegistry
        ? beaconRegistry.requestUpdate(command.beaconId)
        : { ok: false, error: BEACONS_UNAVAILABLE }
      send(ackResult(id, command, requested))
      return true
    }
    case "settings.startMcpOAuth": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        send(ackResult(id, command, { ok: false, error: "not found or unsupported transport" }))
        return true
      }
      try {
        const result = await startMcpOAuth(entry, {
          persist: (oauth) => void resolvedAppSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
        })
        send(ackResult(id, command, result.kind === "authorizationUrl"
          ? { ok: true, authorizationUrl: result.authorizationUrl }
          : { ok: true, alreadyAuthenticated: true }))
      } catch (err) {
        send(ackResult(id, command, { ok: false, error: err instanceof Error ? err.message : "oauth start failed" }))
      }
      return true
    }
    case "settings.completeMcpOAuth": {
      const snapshot = resolvedAppSettings.getSnapshot()
      const entry = snapshot.customMcpServers.find((s) => s.id === command.id)
      if (!entry || entry.transport === "stdio") {
        send(ackResult(id, command, { ok: false, error: "not found" }))
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
        send(ackResult(id, command, { ok: true, testResult: result }))
      } catch (err) {
        send(ackResult(id, command, { ok: false, error: err instanceof Error ? err.message : "oauth complete failed" }))
      }
      return true
    }
    case "settings.readLlmProvider": {
      send(ackResult(id, command, await resolvedLlmProvider.read()))
      return true
    }
    case "settings.listOpenRouterModels": {
      const models = listOpenRouterModels ? await listOpenRouterModels() : []
      send(ackResult(id, command, models))
      return true
    }
    case "settings.getChangelog": {
      const releases = await fetchGitHubReleases("cuongtranba/kanna")
      send(ackResult(id, command, releases))
      return true
    }
    case "settings.writeLlmProvider": {
      const snapshot = await resolvedLlmProvider.write({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      })
      send(ackResult(id, command, snapshot))
      return true
    }
    case "settings.validateLlmProvider": {
      const result = await resolvedLlmProvider.validate({
        provider: command.provider,
        apiKey: command.apiKey,
        model: command.model,
        baseUrl: command.baseUrl,
      })
      send(ackResult(id, command, result))
      return true
    }
    case "skills.search": {
      const snapshot = await searchSkills(command.query, command.limit)
      send(ackResult(id, command, snapshot))
      return true
    }
    case "skills.install": {
      const result = await installSkill(command.source, command.skillId)
      send(ackResult(id, command, result))
      return true
    }
    case "skills.uninstall": {
      const result = await uninstallSkill(command.skillId)
      send(ackResult(id, command, result))
      return true
    }
    case "skills.listInstalled": {
      const result = await listInstalledSkills()
      send(ackResult(id, command, result))
      return true
    }
    case "packages.listInstalled": {
      const result = await readPackageInventory()
      send(ackResult(id, command, result))
      return true
    }
    case "packages.checkUpdates": {
      const result = await packageUpdateManager?.checkUpdates({ force: true }) ?? null
      send(ackResult(id, command, result))
      return true
    }
    case "packages.update": {
      const results = await packageUpdateManager?.applyUpdates([command.id]) ?? []
      send(ackResult(id, command, results))
      void packageUpdateManager?.checkUpdates({ force: true })
      return true
    }
    case "packages.updateAll": {
      const results = await packageUpdateManager?.applyUpdates(command.ids) ?? []
      send(ackResult(id, command, results))
      void packageUpdateManager?.checkUpdates({ force: true })
      return true
    }
    default:
      return false
  }
}
