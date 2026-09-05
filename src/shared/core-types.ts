
export const STORE_VERSION = 3 as const
export const PROTOCOL_VERSION = 1 as const

export const AGENT_PROVIDERS = ["claude", "codex", "openrouter"] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]
export type LlmProviderKind = "openai" | "openrouter" | "custom"
export type AppThemePreference = "light" | "dark" | "system"
export type ChatSoundPreference = "never" | "unfocused" | "always"
export type ChatSoundId = "blow" | "bottle" | "frog" | "funk" | "glass" | "ping" | "pop" | "purr" | "tink"
export type DefaultProviderPreference = "last_used" | AgentProvider
export type EditorPreset = "cursor" | "vscode" | "xcode" | "windsurf" | "custom"
export const DEFAULT_OPENAI_SDK_MODEL = "gpt-5.4-mini"

export type AttachmentKind = "image" | "file" | "mention"

export type KannaStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting_for_user"
  | "failed"
