import { create } from "zustand"
import { timerAdapter } from "../adapters/timer.adapter"
import type { TimerPort } from "../ports/timerPort"
import { MOTION_DURATION } from "../lib/motion"

interface NewSessionState {
  spawnedChatId: string | null
  markSpawned(chatId: string, timer?: TimerPort): void
  clearSpawned(chatId: string): void
}

export const useNewSessionStore = create<NewSessionState>((set, get) => {
  let pendingClear: number | null = null

  return {
    spawnedChatId: null,

    markSpawned: (chatId, timer = timerAdapter) => {
      if (pendingClear !== null) timer.clearTimeout(pendingClear)
      set({ spawnedChatId: chatId })
      pendingClear = timer.setTimeout(() => {
        pendingClear = null
        get().clearSpawned(chatId)
      }, MOTION_DURATION.sequence)
    },

    clearSpawned: (chatId) => {
      if (get().spawnedChatId !== chatId) return
      set({ spawnedChatId: null })
    },
  }
})

export function selectIsSpawning(chatId: string | null) {
  return (state: NewSessionState): boolean =>
    chatId !== null && state.spawnedChatId === chatId
}

export function selectIsAnySpawning(state: NewSessionState): boolean {
  return state.spawnedChatId !== null
}
