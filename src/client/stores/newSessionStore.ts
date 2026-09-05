import { create } from "zustand"
import { timerAdapter } from "../adapters/timer.adapter"
import type { TimerPort } from "../ports/timerPort"
import { MOTION_DURATION } from "../lib/motion"

/**
 * The clock for the new-session transition.
 *
 * Creating a chat is one continuous sentence across four components — the
 * sidebar makes room, a row is born, the shell steps back, the chat surface
 * comes forward, the composer arrives focused, the transcript opens. No single
 * component owns that, so the shared thing is here: which chat was just
 * spawned, and for how long that is still true.
 *
 * **Deliberately a flag, not a timeline.** The handoff drives this with one
 * anime.js timeline over element refs registered from four components. A route
 * change happens in the MIDDLE of this sequence, so half those refs do not
 * exist when the timeline is built and the other half are replaced while it
 * runs. Each beat is therefore its own CSS animation, delayed to its offset,
 * reading one shared "is this the new chat" flag. The sentence is identical;
 * the difference is that a beat whose component never mounts costs that beat
 * and not the whole sequence.
 *
 * **The flag clears itself**, because a CSS animation plays on class arrival
 * and would never play again while the class stayed. Clearing after
 * `MOTION_DURATION.sequence` puts the surfaces back to rest and makes the next
 * spawn a fresh arrival.
 */
interface NewSessionState {
  /** The chat currently playing its arrival, or null. */
  spawnedChatId: string | null
  /**
   * Begin the sentence for `chatId`. Supersedes any spawn still playing — the
   * user creating a second chat mid-transition wants the second one.
   */
  markSpawned(chatId: string, timer?: TimerPort): void
  /** Ends it early. Idempotent, and ignores a chat that is not the live one. */
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

/**
 * Whether `chatId` is the chat currently arriving.
 *
 * A selector rather than a raw field read so every consumer asks the same
 * question, and so a component subscribes to its OWN answer instead of
 * re-rendering whenever any chat spawns.
 */
export function selectIsSpawning(chatId: string | null) {
  return (state: NewSessionState): boolean =>
    chatId !== null && state.spawnedChatId === chatId
}

/** True while any chat is arriving — what the shell beats key on. */
export function selectIsAnySpawning(state: NewSessionState): boolean {
  return state.spawnedChatId !== null
}
