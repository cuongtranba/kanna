// Core primitive types shared across all domain modules.
// Extracted from types.ts to break circular-import chains between
// domain-specific type files (e.g. app-settings-types, subagent-types).
//
// Do NOT add complex interfaces here — keep this file to simple
// union types, string-literal unions, and small constants.

export const STORE_VERSION = 3 as const
export const PROTOCOL_VERSION = 1 as const

export type AgentProvider = "claude" | "codex" | "openrouter"
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
