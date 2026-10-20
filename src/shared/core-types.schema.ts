import { z } from "zod"
import {
  AGENT_PROVIDERS,
  type AgentProvider,
  type AppThemePreference,
  type AttachmentKind,
  type ChatSoundId,
  type ChatSoundPreference,
  type DefaultProviderPreference,
  type EditorPreset,
  type LlmProviderKind,
} from "./core-types"
import { assertParity } from "./type-parity"

export const agentProviderSchema = z.enum(AGENT_PROVIDERS)
export const editorPresetSchema = z.enum(["cursor", "vscode", "xcode", "windsurf", "custom"])
export const editorOpenSettingsSchema = z.object({ preset: editorPresetSchema, commandTemplate: z.string() })
export const appThemePreferenceSchema = z.enum(["light", "dark", "system"])
export const chatSoundPreferenceSchema = z.enum(["never", "unfocused", "always"])
export const chatSoundIdSchema = z.enum(["blow", "bottle", "frog", "funk", "glass", "ping", "pop", "purr", "tink"])
export const defaultProviderPreferenceSchema = z.enum(["last_used", ...AGENT_PROVIDERS])
export const llmProviderKindSchema = z.enum(["openai", "openrouter", "custom"])
export const attachmentKindSchema = z.enum(["image", "file", "mention"])

assertParity<z.output<typeof agentProviderSchema>, AgentProvider>()
assertParity<z.output<typeof editorPresetSchema>, EditorPreset>()
assertParity<z.output<typeof appThemePreferenceSchema>, AppThemePreference>()
assertParity<z.output<typeof chatSoundPreferenceSchema>, ChatSoundPreference>()
assertParity<z.output<typeof chatSoundIdSchema>, ChatSoundId>()
assertParity<z.output<typeof defaultProviderPreferenceSchema>, DefaultProviderPreference>()
assertParity<z.output<typeof llmProviderKindSchema>, LlmProviderKind>()
assertParity<z.output<typeof attachmentKindSchema>, AttachmentKind>()
