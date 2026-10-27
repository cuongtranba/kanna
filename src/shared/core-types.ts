import { oneOf } from "./vocab"


export const STORE_VERSION = 3 as const
export const PROTOCOL_VERSION = 1 as const

export const DEFAULT_CHAT_TITLE = "New Chat"

export function isUntitledChat(title: string): boolean {
  return title === DEFAULT_CHAT_TITLE
}

export const AGENT_PROVIDERS = ["claude", "codex", "openrouter", "custom"] as const
export type AgentProvider = (typeof AGENT_PROVIDERS)[number]
export const isAgentProvider = oneOf(AGENT_PROVIDERS)
export const LLM_PROVIDER_KINDS = ["openai", "openrouter", "custom"] as const
export type LlmProviderKind = (typeof LLM_PROVIDER_KINDS)[number]
export const APP_THEME_PREFERENCES = ["light", "dark", "system"] as const
export type AppThemePreference = (typeof APP_THEME_PREFERENCES)[number]
export const CHAT_SOUND_PREFERENCES = ["never", "unfocused", "always"] as const
export type ChatSoundPreference = (typeof CHAT_SOUND_PREFERENCES)[number]
export const CHAT_SOUND_IDS = ["blow", "bottle", "frog", "funk", "glass", "ping", "pop", "purr", "tink"] as const
export type ChatSoundId = (typeof CHAT_SOUND_IDS)[number]
export const DEFAULT_PROVIDER_PREFERENCES = ["last_used", ...AGENT_PROVIDERS] as const
export type DefaultProviderPreference = (typeof DEFAULT_PROVIDER_PREFERENCES)[number]
export const EDITOR_PRESETS = ["cursor", "vscode", "xcode", "windsurf", "custom"] as const
export type EditorPreset = (typeof EDITOR_PRESETS)[number]
export const DEFAULT_OPENAI_SDK_MODEL = "gpt-5.4-mini"

export const ATTACHMENT_KINDS = ["image", "file", "mention"] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export type KannaStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting_for_user"
  | "failed"
