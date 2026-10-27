import { create } from "zustand"
import type { AppSettingsPatch, AppSettingsSnapshot, CustomModelEntry, McpServerConfig, TextSnippet } from "../../shared/types"
import type { BeaconConfig } from "../../shared/beacon-config"
import type { CustomProviderPublic } from "../../shared/custom-providers"
import type { McpSource } from "../../shared/mcp-sources/types"
import { DEFAULT_TERMINAL_SCROLLBACK } from "../../shared/terminal-scrollback"
import { DEFAULT_EDITOR_PRESET, getDefaultEditorCommandTemplate } from "./terminalPreferencesStore"
import type { ChatSoundId, ChatSoundPreference, EditorPreset } from "../../shared/core-types"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import { REMOTE_MCP_SETTINGS_DEFAULTS, type RemoteMcpSettings } from "../../shared/settings/remote-mcp"
import { SERVICE_BUS_PUBLIC_DEFAULTS, applyServiceBusPatchToPublic, type ServiceBusSettingsPublic } from "../../shared/service-bus/jetstream-config"

type AppSettingsHydrationStatus = "idle" | "loading" | "ready" | "error"

interface AppSettingsStoreState {
  settings: AppSettingsSnapshot | null
  hydrationStatus: AppSettingsHydrationStatus
  setHydrationStatus: (status: AppSettingsHydrationStatus) => void
  setFromServer: (settings: AppSettingsSnapshot) => void
  applyOptimisticPatch: (patch: AppSettingsPatch) => void
}

export function mergeAppSettingsPatch(
  settings: AppSettingsSnapshot,
  patch: AppSettingsPatch
): AppSettingsSnapshot {
  return {
    ...settings,
    ...patch,
    terminal: {
      ...settings.terminal,
      ...patch.terminal,
    },
    panes: {
      ...settings.panes,
      ...patch.panes,
    },
    editor: {
      ...settings.editor,
      ...patch.editor,
    },
    typography: {
      ...settings.typography,
      ...patch.typography,
    },
    providerDefaults: {
      claude: {
        ...settings.providerDefaults.claude,
        ...patch.providerDefaults?.claude,
        modelOptions: {
          ...settings.providerDefaults.claude.modelOptions,
          ...patch.providerDefaults?.claude?.modelOptions,
        },
      },
      codex: {
        ...settings.providerDefaults.codex,
        ...patch.providerDefaults?.codex,
        modelOptions: {
          ...settings.providerDefaults.codex.modelOptions,
          ...patch.providerDefaults?.codex?.modelOptions,
        },
      },
      openrouter: {
        ...settings.providerDefaults.openrouter,
        ...patch.providerDefaults?.openrouter,
        modelOptions: {},
      },
      custom: {
        ...settings.providerDefaults.custom,
        ...patch.providerDefaults?.custom,
        modelOptions: {},
      },
    },
    cloudflareTunnel: {
      ...settings.cloudflareTunnel,
      ...patch.cloudflareTunnel,
    },
    push: {
      ...settings.push,
      ...patch.push,
    },
    telemetry: {
      ...settings.telemetry,
      ...patch.telemetry,
    },
    claudeAuth: {
      tokens: patch.claudeAuth?.tokens ?? settings.claudeAuth.tokens,
      concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? settings.claudeAuth.concurrencyDefault,
    },
    auth: {
      ...settings.auth,
      ...patch.auth,
    },
    uploads: {
      ...settings.uploads,
      ...patch.uploads,
    },
    subagents: settings.subagents,
    customMcpServers: settings.customMcpServers,
    customBeacons: settings.customBeacons,
    customModels: settings.customModels,
    mcpSources: settings.mcpSources,
    customProviders: settings.customProviders,
    textSnippets: settings.textSnippets,
    plugins: {
      ...settings.plugins,
      ...patch.plugins,
    },
    installedPlugins: settings.installedPlugins,
    remoteMcp: {
      ...settings.remoteMcp,
      ...patch.remoteMcp,
    },
    serviceBus: applyServiceBusPatchToPublic(settings.serviceBus, patch.serviceBus),
    claudeDriver: {
      lifecycle: {
        ...settings.claudeDriver.lifecycle,
        ...patch.claudeDriver?.lifecycle,
      },
    },
    globalPromptAppend: patch.globalPromptAppend ?? settings.globalPromptAppend,
    subagentRuntime: {
      runTimeoutMs: patch.subagentRuntime?.runTimeoutMs ?? settings.subagentRuntime.runTimeoutMs,
      defaultLoopSubagentId: patch.subagentRuntime?.defaultLoopSubagentId !== undefined
        ? patch.subagentRuntime.defaultLoopSubagentId
        : settings.subagentRuntime.defaultLoopSubagentId,
    },
    packageUpdates: {
      ...settings.packageUpdates,
      ...patch.packageUpdates,
    },
  }
}

export const useAppSettingsStore = create<AppSettingsStoreState>()((set) => ({
  settings: null,
  hydrationStatus: "idle",
  setHydrationStatus: (hydrationStatus) => set({ hydrationStatus }),
  setFromServer: (settings) => set({ settings, hydrationStatus: "ready" }),
  applyOptimisticPatch: (patch) =>
    set((state) => ({
      settings: state.settings ? mergeAppSettingsPatch(state.settings, patch) : state.settings,
    })),
}))

const EMPTY_MCP_SERVERS: readonly McpServerConfig[] = []

export const selectCustomMcpServers = (state: AppSettingsStoreState): readonly McpServerConfig[] =>
  state.settings?.customMcpServers ?? EMPTY_MCP_SERVERS

const EMPTY_BEACONS: readonly BeaconConfig[] = []

export const selectCustomBeacons = (state: AppSettingsStoreState): readonly BeaconConfig[] =>
  state.settings?.customBeacons ?? EMPTY_BEACONS

const EMPTY_CUSTOM_MODELS: readonly CustomModelEntry[] = []

export const selectCustomModels = (state: AppSettingsStoreState): readonly CustomModelEntry[] =>
  state.settings?.customModels ?? EMPTY_CUSTOM_MODELS

const EMPTY_MCP_SOURCES: readonly McpSource[] = []

export const selectMcpSources = (state: AppSettingsStoreState): readonly McpSource[] =>
  state.settings?.mcpSources ?? EMPTY_MCP_SOURCES

const EMPTY_CUSTOM_PROVIDERS: readonly CustomProviderPublic[] = []

export const selectCustomProviders = (state: AppSettingsStoreState): readonly CustomProviderPublic[] =>
  state.settings?.customProviders ?? EMPTY_CUSTOM_PROVIDERS

const EMPTY_TEXT_SNIPPETS: readonly TextSnippet[] = []

export const selectTextSnippets = (state: AppSettingsStoreState): readonly TextSnippet[] =>
  state.settings?.textSnippets ?? EMPTY_TEXT_SNIPPETS

const EMPTY_INSTALLED_PLUGINS: readonly InstalledPluginConfig[] = []

export const selectPluginsEnabled = (state: AppSettingsStoreState): boolean =>
  state.settings?.plugins.enabled ?? false

export const selectInstalledPlugins = (state: AppSettingsStoreState): readonly InstalledPluginConfig[] =>
  state.settings?.installedPlugins ?? EMPTY_INSTALLED_PLUGINS

export const selectRemoteMcpSettings = (state: AppSettingsStoreState): RemoteMcpSettings =>
  state.settings?.remoteMcp ?? REMOTE_MCP_SETTINGS_DEFAULTS

export const selectServiceBusSettings = (state: AppSettingsStoreState): ServiceBusSettingsPublic =>
  state.settings?.serviceBus ?? SERVICE_BUS_PUBLIC_DEFAULTS

const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450

export const selectScrollbackLines = (state: AppSettingsStoreState): number =>
  state.settings?.terminal.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK

export const selectMinColumnWidth = (state: AppSettingsStoreState): number =>
  state.settings?.terminal.minColumnWidth ?? DEFAULT_TERMINAL_MIN_COLUMN_WIDTH

export const selectEditorPreset = (state: AppSettingsStoreState): EditorPreset =>
  state.settings?.editor.preset ?? DEFAULT_EDITOR_PRESET

export const selectEditorCommandTemplate = (state: AppSettingsStoreState): string => {
  const preset = state.settings?.editor.preset ?? DEFAULT_EDITOR_PRESET
  const template = state.settings?.editor.commandTemplate
  const trimmed = template?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : getDefaultEditorCommandTemplate(preset)
}

export const selectChatSoundPreference = (state: AppSettingsStoreState): ChatSoundPreference =>
  state.settings?.chatSoundPreference ?? "always"

export const selectChatSoundId = (state: AppSettingsStoreState): ChatSoundId =>
  state.settings?.chatSoundId ?? "funk"
