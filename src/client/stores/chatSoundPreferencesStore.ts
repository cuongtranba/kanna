import { create } from "zustand"
import { CHAT_SOUND_IDS } from "../../shared/core-types"
import {
  DEFAULT_CHAT_SOUND_ID,
  DEFAULT_CHAT_SOUND_PREFERENCE,
  normalizeChatSoundId,
  normalizeChatSoundPreference,
} from "../../shared/settings/chat-sound"
import type { ChatSoundId, ChatSoundPreference } from "../../shared/types"

export type { ChatSoundId, ChatSoundPreference }

export {
  DEFAULT_CHAT_SOUND_ID,
  DEFAULT_CHAT_SOUND_PREFERENCE,
  normalizeChatSoundId,
  normalizeChatSoundPreference,
}

function chatSoundLabel(id: ChatSoundId): string {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

export const CHAT_SOUND_OPTIONS: Array<{ value: ChatSoundId; label: string }> = CHAT_SOUND_IDS.map(
  (id) => ({ value: id, label: chatSoundLabel(id) }),
)

export interface ChatSoundPreferencesState {
  chatSoundPreference: ChatSoundPreference
  chatSoundId: ChatSoundId
  setChatSoundPreference: (value: ChatSoundPreference) => void
  setChatSoundId: (value: ChatSoundId) => void
}

export const useChatSoundPreferencesStore = create<ChatSoundPreferencesState>()(
  (set) => ({
    chatSoundPreference: DEFAULT_CHAT_SOUND_PREFERENCE,
    chatSoundId: DEFAULT_CHAT_SOUND_ID,
    setChatSoundPreference: (value) => set({ chatSoundPreference: normalizeChatSoundPreference(value) }),
    setChatSoundId: (value) => set({ chatSoundId: normalizeChatSoundId(value) }),
  })
)
