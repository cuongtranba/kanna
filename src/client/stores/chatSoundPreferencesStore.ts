import { create } from "zustand"
import type { ChatSoundId, ChatSoundPreference } from "../../shared/types"

export type { ChatSoundId, ChatSoundPreference }

export const DEFAULT_CHAT_SOUND_PREFERENCE: ChatSoundPreference = "always"
export const DEFAULT_CHAT_SOUND_ID: ChatSoundId = "funk"

export const CHAT_SOUND_OPTIONS: Array<{ value: ChatSoundId; label: string }> = [
  { value: "blow", label: "Blow" },
  { value: "bottle", label: "Bottle" },
  { value: "frog", label: "Frog" },
  { value: "funk", label: "Funk" },
  { value: "glass", label: "Glass" },
  { value: "ping", label: "Ping" },
  { value: "pop", label: "Pop" },
  { value: "purr", label: "Purr" },
  { value: "tink", label: "Tink" },
]

export function normalizeChatSoundPreference(value?: string): ChatSoundPreference {
  switch (value) {
    case "never":
    case "unfocused":
    case "always":
      return value
    default:
      return DEFAULT_CHAT_SOUND_PREFERENCE
  }
}

export function normalizeChatSoundId(value?: string): ChatSoundId {
  switch (value) {
    case "blow":
    case "bottle":
    case "frog":
    case "funk":
    case "glass":
    case "ping":
    case "pop":
    case "purr":
    case "tink":
      return value
    default:
      return DEFAULT_CHAT_SOUND_ID
  }
}

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
