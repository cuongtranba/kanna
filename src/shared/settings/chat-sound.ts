import { isChatSoundId, isChatSoundPreference } from "../app-settings-types"
import type { ChatSoundId, ChatSoundPreference } from "../core-types"

export const DEFAULT_CHAT_SOUND_PREFERENCE: ChatSoundPreference = "always"
export const DEFAULT_CHAT_SOUND_ID: ChatSoundId = "funk"

export function normalizeChatSoundPreference<T>(value: T): ChatSoundPreference {
  return isChatSoundPreference(value) ? value : DEFAULT_CHAT_SOUND_PREFERENCE
}

export function normalizeChatSoundId<T>(value: T): ChatSoundId {
  return isChatSoundId(value) ? value : DEFAULT_CHAT_SOUND_ID
}
