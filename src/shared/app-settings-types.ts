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
import { DEFAULT_VAPID_SUBJECT } from "./vapid-subject"
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
  // historical 1-token-per-chat invariant. Any integer at or above
  // OAUTH_TOKEN_MAX_CONCURRENT_MIN; there is no upper bound.
  maxConcurrent?: number
}

export interface ClaudeAuthSettings {
  tokens: OAuthTokenEntry[]
  // Pool-wide default applied to tokens whose maxConcurrent is omitted.
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

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

/**
 * User-configurable Web Push settings. `contactSubject` is the VAPID `sub`
 * (JWT subject) claim used to sign push messages — push services reject a
 * malformed one (Apple returns `403 BadJwtToken`). Validated via
 * `isValidVapidSubject` in `src/shared/vapid-subject.ts`.
 */
export interface PushSettings {
  contactSubject: string
}

export const PUSH_DEFAULTS: PushSettings = {
  contactSubject: DEFAULT_VAPID_SUBJECT,
}

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
  | "focusPaneLeft"
  | "focusPaneRight"
  | "focusPaneUp"
  | "focusPaneDown"
  | "splitPaneRight"
  | "splitPaneDown"
  | "closePaneTab"
  | "nextPaneTab"
  | "previousPaneTab"
  | "resizePaneLeft"
  | "resizePaneRight"
  | "resizePaneUp"
  | "resizePaneDown"

/**
 * Pane commands deliberately sit on `cmd+ctrl` / `ctrl+alt`.
 *
 * `cmd+alt` is already the `jumpToSidebarChat` modifier: holding it reveals the
 * sidebar number-jump hints regardless of which other key is pressed, so a
 * `cmd+alt+…` pane binding would flash that overlay on every use. `ctrl+shift`
 * and `cmd+w` families are reserved by browsers (new incognito window, close
 * tab) and cannot be prevented from a page.
 *
 * Resize adds Shift to the focus arrows: the two commands are the same gesture
 * aimed at the same axis, and modifier matching is exact, so they cannot
 * collide.
 */
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
  panes: {
    /** How narrow a tab may get before the strip scrolls instead of shrinking. */
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
}

export interface AppSettingsPatch {
  analyticsEnabled?: boolean
  browserSettingsMigrated?: boolean
  theme?: AppThemePreference
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
  }
  cloudflareTunnel?: Partial<CloudflareTunnelSettings>
  push?: Partial<PushSettings>
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
