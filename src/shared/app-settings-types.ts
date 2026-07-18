// Application settings domain types.
// Extracted from types.ts to keep the barrel lean.
// All external consumers importing from "../shared/types" continue to work unchanged.

import type {
  AppThemePreference,
  ChatSoundPreference,
  ChatSoundId,
  EditorPreset,
  DefaultProviderPreference,
  LlmProviderKind,
} from "./core-types"
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
  McpServerConfig,
  McpServerInput,
  McpServerPatch,
  McpServerTestResult,
  McpOAuthState,
} from "./mcp-types"
import type { Subagent, SubagentInput, SubagentPatch } from "./subagent-types"

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthSettings {
  sessionMaxAgeDays: number
}

export const AUTH_DEFAULTS: AuthSettings = {
  sessionMaxAgeDays: 30,
}

export const AUTH_SESSION_MAX_AGE_DAYS_MIN = 1
export const AUTH_SESSION_MAX_AGE_DAYS_MAX = 365

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
  // Per-token concurrent-chat cap. When omitted, the pool falls back to
  // ClaudeAuthSettings.concurrencyDefault. Default 1 preserves the
  // historical 1-token-per-chat invariant. Range
  // [OAUTH_TOKEN_MAX_CONCURRENT_MIN, OAUTH_TOKEN_MAX_CONCURRENT_MAX].
  maxConcurrent?: number
}

export interface ClaudeAuthSettings {
  tokens: OAuthTokenEntry[]
  // Pool-wide default applied to tokens whose maxConcurrent is omitted.
  concurrencyDefault: number
}

export const OAUTH_TOKEN_MAX_CONCURRENT_MIN = 1
export const OAUTH_TOKEN_MAX_CONCURRENT_MAX = 5
export const OAUTH_TOKEN_CONCURRENCY_DEFAULT = 1

export const CLAUDE_AUTH_DEFAULTS: ClaudeAuthSettings = {
  tokens: [],
  concurrencyDefault: OAUTH_TOKEN_CONCURRENCY_DEFAULT,
}

export const OAUTH_TOKEN_LABEL_MAX = 64
export const OAUTH_TOKEN_VALUE_MAX = 1024

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadSettings {
  maxFileSizeMb: number
}

export const UPLOAD_DEFAULTS: UploadSettings = {
  maxFileSizeMb: 100,
}

export const UPLOAD_MAX_FILE_SIZE_MB_MIN = 1
export const UPLOAD_MAX_FILE_SIZE_MB_MAX = 2048

export const GLOBAL_PROMPT_APPEND_MAX_CHARS = 8_000

// ---------------------------------------------------------------------------
// Claude driver
// ---------------------------------------------------------------------------

export type ClaudeDriverPreference = "sdk" | "pty"

export const CLAUDE_DRIVER_VALUES: readonly ClaudeDriverPreference[] = ["sdk", "pty"]

export function isClaudeDriverPreference(value: string | null | undefined): value is ClaudeDriverPreference {
  return value === "sdk" || value === "pty"
}

export interface ClaudePtyLifecycleSettings {
  idleTimeoutMs: number
  maxConcurrent: number
}

export const CLAUDE_PTY_LIFECYCLE_DEFAULTS: ClaudePtyLifecycleSettings = {
  idleTimeoutMs: 600_000,
  maxConcurrent: 4,
}

export const CLAUDE_PTY_IDLE_TIMEOUT_MS_MIN = 60_000
export const CLAUDE_PTY_IDLE_TIMEOUT_MS_MAX = 3_600_000
export const CLAUDE_PTY_MAX_CONCURRENT_MIN = 1
export const CLAUDE_PTY_MAX_CONCURRENT_MAX = 16

export interface ClaudeDriverSettings {
  preference: ClaudeDriverPreference
  lifecycle: ClaudePtyLifecycleSettings
}

export const CLAUDE_DRIVER_DEFAULTS: ClaudeDriverSettings = {
  preference: "sdk",
  lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS },
}

export type ClaudeSessionLifecycleStatus = "cold" | "warming" | "active" | "idle" | "cooling"

export interface ChatSessionStateSnapshot {
  chatId: string
  state: ClaudeSessionLifecycleStatus
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Cloudflare tunnel
// ---------------------------------------------------------------------------

export type CloudflareTunnelMode = "always-ask" | "auto-expose"

export interface CloudflareTunnelSettings {
  enabled: boolean
  cloudflaredPath: string
  mode: CloudflareTunnelMode
}

export const CLOUDFLARE_TUNNEL_DEFAULTS: CloudflareTunnelSettings = {
  enabled: false,
  cloudflaredPath: "cloudflared",
  mode: "always-ask",
}

export type CloudflareTunnelState = "proposed" | "active" | "stopped" | "failed"

export interface CloudflareTunnelRecord {
  tunnelId: string
  chatId: string
  port: number
  state: CloudflareTunnelState
  url: string | null
  error: string | null
  proposedAt: number
  activatedAt: number | null
  stoppedAt: number | null
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

export type KeybindingAction =
  | "toggleEmbeddedTerminal"
  | "toggleRightSidebar"
  | "openInFinder"
  | "openInEditor"
  | "addSplitTerminal"
  | "jumpToSidebarChat"
  | "createChatInCurrentProject"
  | "openAddProject"
  | "newStack"
  | "newStackChat"
  | "jumpToStacks"

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string[]> = {
  toggleEmbeddedTerminal: ["cmd+j", "ctrl+`"],
  toggleRightSidebar: ["cmd+b", "ctrl+b"],
  openInFinder: ["cmd+alt+f", "ctrl+alt+f"],
  openInEditor: ["cmd+shift+o", "ctrl+shift+o"],
  addSplitTerminal: ["cmd+/", "ctrl+/"],
  jumpToSidebarChat: ["cmd+alt"],
  createChatInCurrentProject: ["cmd+alt+n"],
  openAddProject: ["cmd+alt+o"],
  newStack: ["cmd+alt+w"],
  newStackChat: ["cmd+alt+shift+n"],
  jumpToStacks: ["g s"],
}

export const KEYBINDING_ACTIONS: readonly KeybindingAction[] = [
  "toggleEmbeddedTerminal",
  "toggleRightSidebar",
  "openInFinder",
  "openInEditor",
  "addSplitTerminal",
  "jumpToSidebarChat",
  "createChatInCurrentProject",
  "openAddProject",
  "newStack",
  "newStackChat",
  "jumpToStacks",
] satisfies KeybindingAction[]

export interface KeybindingsSnapshot {
  bindings: Record<KeybindingAction, string[]>
  warning: string | null
  filePathDisplay: string
}

// ---------------------------------------------------------------------------
// App settings snapshot & patch
// ---------------------------------------------------------------------------

export interface AppSettingsSnapshot {
  analyticsEnabled: boolean
  browserSettingsMigrated: boolean
  theme: AppThemePreference
  chatSoundPreference: ChatSoundPreference
  chatSoundId: ChatSoundId
  terminal: {
    scrollbackLines: number
    minColumnWidth: number
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
  auth: AuthSettings
  claudeAuth: ClaudeAuthSettings
  uploads: UploadSettings
  subagents: Subagent[]
  customMcpServers: McpServerConfig[]
  customModels: CustomModelEntry[]
  textSnippets: TextSnippet[]
  claudeDriver: ClaudeDriverSettings
  globalPromptAppend: string
  shareDefaultTtlHours: number
  subagentRuntime: SubagentRuntimeSettings
}

/**
 * Runtime knobs for delegated subagent runs (delegate_subagent) and the
 * autonomous loop (setup_loop). `runTimeoutMs` is the stall/idle watchdog
 * window — a run is aborted only after this long with NO streamed activity,
 * not a total wall-clock cap. `defaultLoopSubagentId` is the subagent
 * setup_loop delegates to when the caller omits an explicit id.
 */
export interface SubagentRuntimeSettings {
  runTimeoutMs: number
  defaultLoopSubagentId: string | null
  /**
   * Subagent an orchestration run (orch_run) delegates each phase to when the
   * caller omits an explicit id. Optional: absent = no default (the caller must
   * pass `subagentId`). Full settings CRUD/UI is a later phase.
   */
  defaultOrchSubagentId?: string | null
}

export interface AppSettingsPatch {
  analyticsEnabled?: boolean
  browserSettingsMigrated?: boolean
  theme?: AppThemePreference
  chatSoundPreference?: ChatSoundPreference
  chatSoundId?: ChatSoundId
  terminal?: Partial<AppSettingsSnapshot["terminal"]>
  editor?: Partial<AppSettingsSnapshot["editor"]>
  defaultProvider?: DefaultProviderPreference
  providerDefaults?: {
    claude?: Partial<ProviderPreference<ClaudeModelOptions>>
    codex?: Partial<ProviderPreference<CodexModelOptions>>
    openrouter?: Partial<ProviderPreference<OpenRouterModelOptions>>
  }
  cloudflareTunnel?: Partial<CloudflareTunnelSettings>
  auth?: Partial<AuthSettings>
  claudeAuth?: Partial<ClaudeAuthSettings>
  uploads?: Partial<UploadSettings>
  subagents?: {
    create?: SubagentInput
    update?: { id: string; patch: SubagentPatch }
    delete?: { id: string }
  }
  customMcpServers?: {
    create?: McpServerInput
    update?: { id: string; patch: McpServerPatch }
    delete?: { id: string }
    setEnabled?: { id: string; enabled: boolean }
    setTestResult?: { id: string; result: McpServerTestResult }
    setOAuthState?: { id: string; oauth: McpOAuthState }
  }
  customModels?: {
    create?: CustomModelInput
    update?: { id: string; patch: CustomModelPatch }
    delete?: { id: string }
  }
  textSnippets?: {
    create?: TextSnippetInput
    update?: { id: string; patch: TextSnippetPatch }
    delete?: { id: string }
  }
  claudeDriver?: {
    preference?: ClaudeDriverPreference
    lifecycle?: Partial<ClaudePtyLifecycleSettings>
  }
  globalPromptAppend?: string
  shareDefaultTtlHours?: number
  subagentRuntime?: Partial<SubagentRuntimeSettings>
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isEditorPreset(value: string): value is EditorPreset {
  return value === "cursor" || value === "vscode" || value === "xcode" || value === "windsurf" || value === "custom"
}

export function isChatSoundPreference(value: string): value is ChatSoundPreference {
  return value === "never" || value === "unfocused" || value === "always"
}

export function isChatSoundId(value: string): value is ChatSoundId {
  return (
    value === "blow" || value === "bottle" || value === "frog" || value === "funk" ||
    value === "glass" || value === "ping" || value === "pop" || value === "purr" || value === "tink"
  )
}

export function isCloudFlareTunnelMode(value: string): value is CloudflareTunnelMode {
  return value === "always-ask" || value === "auto-expose"
}

export function isLlmProviderKind(value: string): value is LlmProviderKind {
  return value === "openai" || value === "openrouter" || value === "custom"
}

export function isAppThemePreference(value: string): value is AppThemePreference {
  return value === "light" || value === "dark" || value === "system"
}
