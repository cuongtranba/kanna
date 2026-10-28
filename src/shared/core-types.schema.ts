import { z } from "zod"
import {
  AGENT_PROVIDERS,
  APP_THEME_PREFERENCES,
  ATTACHMENT_KINDS,
  CHAT_SOUND_IDS,
  CHAT_SOUND_PREFERENCES,
  DEFAULT_PROVIDER_PREFERENCES,
  EDITOR_PRESETS,
  LLM_PROVIDER_KINDS,
} from "./core-types"

export const agentProviderSchema = z.enum(AGENT_PROVIDERS)
export const editorPresetSchema = z.enum(EDITOR_PRESETS)
export const editorOpenSettingsSchema = z.object({ preset: editorPresetSchema, commandTemplate: z.string() })
export const appThemePreferenceSchema = z.enum(APP_THEME_PREFERENCES)
export const chatSoundPreferenceSchema = z.enum(CHAT_SOUND_PREFERENCES)
export const chatSoundIdSchema = z.enum(CHAT_SOUND_IDS)
export const defaultProviderPreferenceSchema = z.enum(DEFAULT_PROVIDER_PREFERENCES)
export const llmProviderKindSchema = z.enum(LLM_PROVIDER_KINDS)
export const attachmentKindSchema = z.enum(ATTACHMENT_KINDS)
