import type { LiveBlock } from "../shared/live-block"

export const LIVE_BLOCK_SEND_INTERVAL_MS = 100

export interface LiveBlockClock {
  now(): number
  schedule(run: () => void, delayMs: number): () => void
}

export type LiveBlockListener = (chatId: string, block: LiveBlock | null) => void

export interface LiveBlockHub {
  publish(chatId: string, block: LiveBlock | null): void
  latest(chatId: string): LiveBlock | null
  subscribe(listener: LiveBlockListener): () => void
}

interface ChatThrottleState {
  latest: LiveBlock | null
  lastSentAt: number | null
  clientHoldsBlock: boolean
  clearing: boolean
  cancelPending: (() => void) | null
}

export const systemLiveBlockClock: LiveBlockClock = {
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const handle = setTimeout(run, delayMs)
    return () => clearTimeout(handle)
  },
}

export function createLiveBlockHub(
  clock: LiveBlockClock = systemLiveBlockClock,
  intervalMs: number = LIVE_BLOCK_SEND_INTERVAL_MS,
): LiveBlockHub {
  const states = new Map<string, ChatThrottleState>()
  const listeners = new Set<LiveBlockListener>()

  const emit = (chatId: string, block: LiveBlock | null) => {
    for (const listener of listeners) listener(chatId, block)
  }

  const sendLatest = (chatId: string, state: ChatThrottleState) => {
    state.cancelPending = null
    if (state.latest === null) return
    state.lastSentAt = clock.now()
    state.clientHoldsBlock = true
    emit(chatId, state.latest)
  }

  const clear = (chatId: string) => {
    const state = states.get(chatId)
    if (!state || state.clearing) return
    state.cancelPending?.()
    state.latest = null
    if (!state.clientHoldsBlock) {
      states.delete(chatId)
      return
    }
    state.clearing = true
    state.lastSentAt = clock.now()
    state.cancelPending = clock.schedule(() => {
      states.delete(chatId)
      emit(chatId, null)
    }, intervalMs)
  }

  const update = (chatId: string, block: LiveBlock) => {
    let state = states.get(chatId)
    if (!state) {
      state = { latest: null, lastSentAt: null, clientHoldsBlock: false, clearing: false, cancelPending: null }
      states.set(chatId, state)
    }
    if (state.clearing) {
      state.cancelPending?.()
      state.cancelPending = null
      state.clearing = false
    }
    state.latest = block
    if (state.cancelPending !== null) return
    const elapsed = state.lastSentAt === null ? intervalMs : clock.now() - state.lastSentAt
    if (elapsed >= intervalMs) {
      sendLatest(chatId, state)
      return
    }
    const tracked = state
    state.cancelPending = clock.schedule(() => sendLatest(chatId, tracked), intervalMs - elapsed)
  }

  return {
    publish: (chatId, block) => {
      if (block === null) clear(chatId)
      else update(chatId, block)
    },
    latest: (chatId) => states.get(chatId)?.latest ?? null,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
