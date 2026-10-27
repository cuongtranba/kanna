import { applyServiceBusPatchToPublic } from "../service-bus/jetstream-config"
import type { AppSettingsPatch, AppSettingsSnapshot } from "../types"

export type SettingsSections = Pick<
  AppSettingsSnapshot,
  | "terminal"
  | "panes"
  | "editor"
  | "typography"
  | "providerDefaults"
  | "cloudflareTunnel"
  | "push"
  | "telemetry"
  | "auth"
  | "claudeAuth"
  | "uploads"
  | "plugins"
  | "remoteMcp"
  | "claudeDriver"
  | "globalPromptAppend"
  | "shareDefaultTtlHours"
  | "subagentRuntime"
  | "packageUpdates"
>

export function mergeSettingsSections(current: SettingsSections, patch: AppSettingsPatch): SettingsSections {
  const providers = current.providerDefaults
  const providerPatch = patch.providerDefaults
  return {
    terminal: { ...current.terminal, ...patch.terminal },
    panes: { ...current.panes, ...patch.panes },
    editor: { ...current.editor, ...patch.editor },
    typography: { ...current.typography, ...patch.typography },
    providerDefaults: {
      claude: {
        ...providers.claude,
        ...providerPatch?.claude,
        modelOptions: { ...providers.claude.modelOptions, ...providerPatch?.claude?.modelOptions },
      },
      codex: {
        ...providers.codex,
        ...providerPatch?.codex,
        modelOptions: { ...providers.codex.modelOptions, ...providerPatch?.codex?.modelOptions },
      },
      openrouter: { ...providers.openrouter, ...providerPatch?.openrouter, modelOptions: {} },
      custom: { ...providers.custom, ...providerPatch?.custom, modelOptions: {} },
    },
    cloudflareTunnel: { ...current.cloudflareTunnel, ...patch.cloudflareTunnel },
    push: { ...current.push, ...patch.push },
    telemetry: { ...current.telemetry, ...patch.telemetry },
    auth: { ...current.auth, ...patch.auth },
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? current.claudeAuth.tokens,
      concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? current.claudeAuth.concurrencyDefault,
    },
    uploads: { ...current.uploads, ...patch.uploads },
    plugins: { ...current.plugins, ...patch.plugins },
    remoteMcp: { ...current.remoteMcp, ...patch.remoteMcp },
    claudeDriver: { lifecycle: { ...current.claudeDriver.lifecycle, ...patch.claudeDriver?.lifecycle } },
    globalPromptAppend: patch.globalPromptAppend ?? current.globalPromptAppend,
    shareDefaultTtlHours: patch.shareDefaultTtlHours ?? current.shareDefaultTtlHours,
    subagentRuntime: {
      runTimeoutMs: patch.subagentRuntime?.runTimeoutMs ?? current.subagentRuntime.runTimeoutMs,
      defaultLoopSubagentId: patch.subagentRuntime?.defaultLoopSubagentId !== undefined
        ? patch.subagentRuntime.defaultLoopSubagentId
        : current.subagentRuntime.defaultLoopSubagentId,
    },
    packageUpdates: { ...current.packageUpdates, ...patch.packageUpdates },
  }
}

export function mergeAppSettingsPatch(
  snapshot: AppSettingsSnapshot,
  patch: AppSettingsPatch,
): AppSettingsSnapshot {
  return {
    ...snapshot,
    ...patch,
    ...mergeSettingsSections(snapshot, patch),
    subagents: snapshot.subagents,
    customMcpServers: snapshot.customMcpServers,
    customBeacons: snapshot.customBeacons,
    customModels: snapshot.customModels,
    mcpSources: snapshot.mcpSources,
    customProviders: snapshot.customProviders,
    textSnippets: snapshot.textSnippets,
    installedPlugins: snapshot.installedPlugins,
    serviceBus: applyServiceBusPatchToPublic(snapshot.serviceBus, patch.serviceBus),
  }
}
