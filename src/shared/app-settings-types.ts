import {
  APP_THEME_PREFERENCES,
  CHAT_SOUND_IDS,
  CHAT_SOUND_PREFERENCES,
  DEFAULT_PROVIDER_PREFERENCES,
  EDITOR_PRESETS,
  LLM_PROVIDER_KINDS,
  type AppThemePreference,
  type ChatSoundPreference,
  type ChatSoundId,
  type EditorPreset,
  type DefaultProviderPreference,
} from "./core-types"
import { oneOf } from "./vocab"
import type { BeaconConfig, BeaconPatch } from "./beacon-config"
import type { BeaconScope } from "./beacon-scope"
import type { McpSource, McpSourceInput, McpSourcePatch } from "./mcp-sources/types"
import type { PackageKind } from "./packages/types"
import type { AuthSettings } from "./settings/auth"
import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
} from "./settings/auth"
import type {
  CloudflareTunnelMode,
  CloudflareTunnelRecord,
  CloudflareTunnelSettings,
  CloudflareTunnelState,
} from "./settings/cloudflare-tunnel"
import { CLOUDFLARE_TUNNEL_DEFAULTS } from "./settings/cloudflare-tunnel"
import type { PushSettings } from "./settings/push"
import { PUSH_DEFAULTS } from "./settings/push"
import type { RemoteMcpSettings } from "./settings/remote-mcp"
import { REMOTE_MCP_SETTINGS_DEFAULTS } from "./settings/remote-mcp"
import type { ServiceBusSettingsPatch, ServiceBusSettingsPublic } from "./service-bus/jetstream-config"
import type { TelemetrySettings } from "./settings/telemetry"
import { TELEMETRY_DEFAULTS } from "./settings/telemetry"
import type { TypographySettings } from "./settings/typography"
import { TYPOGRAPHY_DEFAULTS } from "./settings/typography"
import type { UploadSettings } from "./settings/uploads"
import {
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
} from "./settings/uploads"
import type { InstalledPluginConfig, PluginSettings } from "./plugins/settings"
import { PLUGIN_SETTINGS_DEFAULTS } from "./plugins/settings"
export type {
  AuthSettings,
  CloudflareTunnelMode,
  CloudflareTunnelRecord,
  CloudflareTunnelSettings,
  CloudflareTunnelState,
  InstalledPluginConfig,
  PluginSettings,
  PushSettings,
  RemoteMcpSettings,
  TelemetrySettings,
  TypographySettings,
  UploadSettings,
}
export {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  CLOUDFLARE_TUNNEL_DEFAULTS,
  PLUGIN_SETTINGS_DEFAULTS,
  PUSH_DEFAULTS,
  REMOTE_MCP_SETTINGS_DEFAULTS,
  TELEMETRY_DEFAULTS,
  TYPOGRAPHY_DEFAULTS,
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
}
import type {
  ChatProviderPreferences,
  ProviderPreference,
  ClaudeModelOptions,
  CodexModelOptions,
  OpenRouterModelOptions,
  CustomModelEntry,
  CustomModelInput,
  CustomModelPatch,
  TextSnippet,
  TextSnippetInput,
  TextSnippetPatch,
} from "./provider-model-types"
import type {
  CustomProviderInput,
  CustomProviderPatch,
  CustomProviderPublic,
} from "./custom-providers"
import type {
  McpServerConfig,
  McpServerInput,
  McpServerPatch,
  McpServerTestResult,
  McpOAuthState,
} from "./mcp-types"
import type { Subagent, SubagentInput, SubagentPatch } from "./subagent-types"


export type OAuthTokenStatus = "active" | "limited" | "error" | "disabled"

export interface OAuthTokenEntry {
  id: string
  label: string
  token: string
  status: OAuthTokenStatus
  limitedUntil: number | null
  lastUsedAt: number | null
  lastErrorAt: number | null
  lastErrorMessage: string | null
  addedAt: number
  maxConcurrent?: number
  baseUrl?: string
}

export interface ClaudeAuthSettings {
  tokens: OAuthTokenEntry[]
  concurrencyDefault: number
}

export const OAUTH_TOKEN_MAX_CONCURRENT_MIN = 1
export const OAUTH_TOKEN_CONCURRENCY_DEFAULT = 1

export function isTokenConcurrency(value: number): boolean {
  return Number.isFinite(value) && Math.round(value) >= OAUTH_TOKEN_MAX_CONCURRENT_MIN
}

export function clampTokenConcurrency(raw: number): number {
  if (!Number.isFinite(raw)) return OAUTH_TOKEN_CONCURRENCY_DEFAULT
  return Math.max(OAUTH_TOKEN_MAX_CONCURRENT_MIN, Math.round(raw))
}

export const CLAUDE_AUTH_DEFAULTS: ClaudeAuthSettings = {
  tokens: [],
  concurrencyDefault: OAUTH_TOKEN_CONCURRENCY_DEFAULT,
}

export const OAUTH_TOKEN_LABEL_MAX = 64
export const OAUTH_TOKEN_VALUE_MAX = 1024
export const OAUTH_TOKEN_BASE_URL_MAX = 512



export const GLOBAL_PROMPT_APPEND_MAX_CHARS = 8_000


export interface ClaudeLifecycleSettings {
  idleTimeoutMs: number
  maxConcurrent: number
}

export const CLAUDE_LIFECYCLE_DEFAULTS: ClaudeLifecycleSettings = {
  idleTimeoutMs: 600_000,
  maxConcurrent: 4,
}

export const CLAUDE_IDLE_TIMEOUT_MS_MIN = 60_000
export const CLAUDE_IDLE_TIMEOUT_MS_MAX = 3_600_000
export const CLAUDE_MAX_CONCURRENT_MIN = 1
export const CLAUDE_MAX_CONCURRENT_MAX = 16

export interface ClaudeDriverSettings {
  lifecycle: ClaudeLifecycleSettings
}

export const CLAUDE_DRIVER_DEFAULTS: ClaudeDriverSettings = {
  lifecycle: { ...CLAUDE_LIFECYCLE_DEFAULTS },
}

export type ClaudeSessionLifecycleStatus = "cold" | "warming" | "active" | "idle" | "cooling"

export interface ChatSessionStateSnapshot {
  chatId: string
  state: ClaudeSessionLifecycleStatus
  updatedAt: number
}


export const KEYBINDING_ACTIONS = [
  "toggleEmbeddedTerminal",
  "toggleRightSidebar",
  "openInFinder",
  "openInEditor",
  "addSplitTerminal",
  "jumpToSidebarChat",
  "openProjectSwitcher",
  "openTabSwitcher",
  "jumpToPaneTab",
  "createChatInCurrentProject",
  "openAddProject",
  "newStack",
  "newStackChat",
  "jumpToStacks",
  "focusPaneLeft",
  "focusPaneRight",
  "focusPaneUp",
  "focusPaneDown",
  "splitPaneRight",
  "splitPaneDown",
  "closePaneTab",
  "nextPaneTab",
  "previousPaneTab",
  "resizePaneLeft",
  "resizePaneRight",
  "resizePaneUp",
  "resizePaneDown",
] as const

export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string[]> = {
  toggleEmbeddedTerminal: ["cmd+j", "ctrl+`"],
  toggleRightSidebar: ["cmd+b", "ctrl+b"],
  openInFinder: ["cmd+alt+f", "ctrl+alt+f"],
  openInEditor: ["cmd+shift+o", "ctrl+shift+o"],
  addSplitTerminal: ["cmd+/", "ctrl+/"],
  jumpToSidebarChat: ["cmd+alt"],
  openProjectSwitcher: ["cmd+k", "ctrl+k"],
  openTabSwitcher: ["alt+`"],
  jumpToPaneTab: ["cmd+ctrl", "ctrl+alt"],
  createChatInCurrentProject: ["cmd+alt+n"],
  openAddProject: ["cmd+alt+o"],
  newStack: ["cmd+alt+w"],
  newStackChat: ["cmd+alt+shift+n"],
  jumpToStacks: ["g s"],
  focusPaneLeft: ["cmd+ctrl+arrowleft", "ctrl+alt+arrowleft"],
  focusPaneRight: ["cmd+ctrl+arrowright", "ctrl+alt+arrowright"],
  focusPaneUp: ["cmd+ctrl+arrowup", "ctrl+alt+arrowup"],
  focusPaneDown: ["cmd+ctrl+arrowdown", "ctrl+alt+arrowdown"],
  splitPaneRight: ["cmd+ctrl+d", "ctrl+alt+d"],
  splitPaneDown: ["cmd+ctrl+e", "ctrl+alt+e"],
  closePaneTab: ["cmd+ctrl+w", "ctrl+alt+q"],
  nextPaneTab: ["cmd+ctrl+j", "ctrl+alt+j"],
  previousPaneTab: ["cmd+ctrl+k", "ctrl+alt+k"],
  resizePaneLeft: ["cmd+ctrl+shift+arrowleft", "ctrl+alt+shift+arrowleft"],
  resizePaneRight: ["cmd+ctrl+shift+arrowright", "ctrl+alt+shift+arrowright"],
  resizePaneUp: ["cmd+ctrl+shift+arrowup", "ctrl+alt+shift+arrowup"],
  resizePaneDown: ["cmd+ctrl+shift+arrowdown", "ctrl+alt+shift+arrowdown"],
}


export interface KeybindingsSnapshot {
  bindings: Record<KeybindingAction, string[]>
  warning: string | null
  filePathDisplay: string
}


export interface AppSettingsSnapshot {
  analyticsEnabled: boolean
  browserSettingsMigrated: boolean
  theme: AppThemePreference
  typography: TypographySettings
  chatSoundPreference: ChatSoundPreference
  chatSoundId: ChatSoundId
  terminal: {
    scrollbackLines: number
    minColumnWidth: number
  }
  panes: {
    tabMinWidth: number
  }
  editor: {
    preset: EditorPreset
    commandTemplate: string
  }
  defaultProvider: DefaultProviderPreference
  providerDefaults: ChatProviderPreferences
  warning: string | null
  filePathDisplay: string
  cloudflareTunnel: CloudflareTunnelSettings
  push: PushSettings
  telemetry: TelemetrySettings
  auth: AuthSettings
  claudeAuth: ClaudeAuthSettings
  uploads: UploadSettings
  subagents: Subagent[]
  customMcpServers: McpServerConfig[]
  customBeacons: BeaconConfig[]
  customModels: CustomModelEntry[]
  mcpSources: McpSource[]
  customProviders: CustomProviderPublic[]
  textSnippets: TextSnippet[]
  claudeDriver: ClaudeDriverSettings
  globalPromptAppend: string
  shareDefaultTtlHours: number
  subagentRuntime: SubagentRuntimeSettings
  packageUpdates: PackageUpdateSettings
  plugins: PluginSettings
  installedPlugins: InstalledPluginConfig[]
  remoteMcp: RemoteMcpSettings
  serviceBus: ServiceBusSettingsPublic
}

export interface SubagentRuntimeSettings {
  runTimeoutMs: number
  defaultLoopSubagentId: string | null
}

export interface PackageUpdateSettings {
  checkEnabled: boolean
  checkIntervalMs: number
  autoApply: boolean
  autoApplyKinds: PackageKind[]
  skillAgents: string[]
}

export const PACKAGE_UPDATE_CHECK_INTERVAL_MIN_MS = 3_600_000
export const PACKAGE_UPDATE_CHECK_INTERVAL_MAX_MS = 2_592_000_000
export const PACKAGE_UPDATE_CHECK_INTERVAL_DEFAULT_MS = 86_400_000

export const PACKAGE_UPDATE_SETTINGS_DEFAULTS: PackageUpdateSettings = {
  checkEnabled: true,
  checkIntervalMs: PACKAGE_UPDATE_CHECK_INTERVAL_DEFAULT_MS,
  autoApply: false,
  autoApplyKinds: [],
  skillAgents: ["universal", "claude-code", "codex"],
}

export interface EntityPatch<P> {
  update?: { id: string; patch: P }
  delete?: { id: string }
}

export interface CollectionPatch<I, P> extends EntityPatch<P> {
  create?: I
}

interface SetEnabledPatch {
  setEnabled?: { id: string; enabled: boolean }
}

export interface AppSettingsPatch {
  analyticsEnabled?: boolean
  browserSettingsMigrated?: boolean
  theme?: AppThemePreference
  typography?: Partial<TypographySettings>
  chatSoundPreference?: ChatSoundPreference
  chatSoundId?: ChatSoundId
  terminal?: Partial<AppSettingsSnapshot["terminal"]>
  panes?: Partial<AppSettingsSnapshot["panes"]>
  editor?: Partial<AppSettingsSnapshot["editor"]>
  defaultProvider?: DefaultProviderPreference
  providerDefaults?: {
    claude?: Partial<ProviderPreference<ClaudeModelOptions>>
    codex?: Partial<ProviderPreference<CodexModelOptions>>
    openrouter?: Partial<ProviderPreference<OpenRouterModelOptions>>
    custom?: Partial<ProviderPreference<OpenRouterModelOptions>>
  }
  cloudflareTunnel?: Partial<CloudflareTunnelSettings>
  push?: Partial<PushSettings>
  telemetry?: Partial<TelemetrySettings>
  auth?: Partial<AuthSettings>
  claudeAuth?: Partial<ClaudeAuthSettings>
  uploads?: Partial<UploadSettings>
  subagents?: CollectionPatch<SubagentInput, SubagentPatch>
  customMcpServers?: CollectionPatch<McpServerInput, McpServerPatch> & SetEnabledPatch & {
    setTestResult?: { id: string; result: McpServerTestResult }
    setOAuthState?: { id: string; oauth: McpOAuthState }
  }
  customBeacons?: EntityPatch<BeaconPatch> & SetEnabledPatch & {
    setScope?: { id: string; scope: BeaconScope }
    addTrustedScript?: { id: string; hash: string }
    removeTrustedScript?: { id: string; hash: string }
  }
  customModels?: CollectionPatch<CustomModelInput, CustomModelPatch>
  mcpSources?: CollectionPatch<McpSourceInput, McpSourcePatch> & SetEnabledPatch
  customProviders?: CollectionPatch<CustomProviderInput, CustomProviderPatch>
  textSnippets?: CollectionPatch<TextSnippetInput, TextSnippetPatch>
  claudeDriver?: {
    lifecycle?: Partial<ClaudeLifecycleSettings>
  }
  globalPromptAppend?: string
  shareDefaultTtlHours?: number
  subagentRuntime?: Partial<SubagentRuntimeSettings>
  packageUpdates?: Partial<PackageUpdateSettings>
  plugins?: Partial<PluginSettings>
  remoteMcp?: Partial<RemoteMcpSettings>
  serviceBus?: ServiceBusSettingsPatch
  installedPlugins?: CollectionPatch<{ sourceDir: string; id: string }, { enabled?: boolean }>
}


export const isEditorPreset = oneOf(EDITOR_PRESETS)
export const isChatSoundPreference = oneOf(CHAT_SOUND_PREFERENCES)
export const isChatSoundId = oneOf(CHAT_SOUND_IDS)
export const isLlmProviderKind = oneOf(LLM_PROVIDER_KINDS)
export const isAppThemePreference = oneOf(APP_THEME_PREFERENCES)
export const isDefaultProviderPreference = oneOf(DEFAULT_PROVIDER_PREFERENCES)
