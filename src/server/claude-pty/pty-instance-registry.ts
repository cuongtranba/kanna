import type { PtyInstanceDelta, PtyInstanceState } from "../../shared/pty-instance"

export type { PtyInstanceDelta, PtyInstanceState }

export type PtyInstanceListener = (delta: PtyInstanceDelta) => void

export interface PtyInstanceSubscribeOptions {
  replay?: boolean
}

export interface PtyInstanceRegistry {
  snapshot(): PtyInstanceState[]
  subscribe(listener: PtyInstanceListener, options?: PtyInstanceSubscribeOptions): () => void
  upsert(chatId: string, patch: Partial<Omit<PtyInstanceState, "chatId">>): void
  remove(chatId: string): void
}

export interface CreatePtyInstanceRegistryOptions {
  /** Trailing-edge coalesce window for "updated" deltas, in ms. 0 disables. */
  coalesceMs?: number
}

const DEFAULT_COALESCE_MS = 100

export function createPtyInstanceRegistry(
  options: CreatePtyInstanceRegistryOptions = {},
): PtyInstanceRegistry {
  const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS
  const states = new Map<string, PtyInstanceState>()
  const listeners = new Set<PtyInstanceListener>()
  const pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>()

  function emit(delta: PtyInstanceDelta): void {
    for (const listener of listeners) listener(delta)
  }

  function clone(state: PtyInstanceState): PtyInstanceState {
    return { ...state }
  }

  function cancelPendingFlush(chatId: string): void {
    const handle = pendingFlushes.get(chatId)
    if (handle) {
      clearTimeout(handle)
      pendingFlushes.delete(chatId)
    }
  }

  function flushUpdate(chatId: string): void {
    pendingFlushes.delete(chatId)
    const state = states.get(chatId)
    if (!state) return
    emit({ type: "updated", instance: clone(state) })
  }

  return {
    snapshot(): PtyInstanceState[] {
      return Array.from(states.values(), clone)
    },

    subscribe(listener, opts): () => void {
      listeners.add(listener)
      if (opts?.replay) {
        for (const state of states.values()) {
          listener({ type: "added", instance: clone(state) })
        }
      }
      return () => {
        listeners.delete(listener)
      }
    },

    upsert(chatId, patch): void {
      const existing = states.get(chatId)
      if (existing) {
        const next: PtyInstanceState = { ...existing, ...patch, chatId }
        states.set(chatId, next)
        if (coalesceMs <= 0) {
          emit({ type: "updated", instance: clone(next) })
          return
        }
        if (!pendingFlushes.has(chatId)) {
          pendingFlushes.set(
            chatId,
            setTimeout(() => flushUpdate(chatId), coalesceMs),
          )
        }
        return
      }
      const baseline: PtyInstanceState = {
        chatId,
        sessionId: null,
        pid: null,
        cwd: "",
        model: "",
        accountLabel: null,
        oauthMasked: null,
        phase: "spawning",
        startedAt: 0,
        lastEventAt: 0,
        turnCount: 0,
        tokensIn: 0,
        tokensOut: 0,
        planMode: null,
        smokeTest: null,
        outputRingTail: null,
        exitedAt: null,
        exitCode: null,
        ...patch,
      }
      states.set(chatId, baseline)
      emit({ type: "added", instance: clone(baseline) })
    },

    remove(chatId): void {
      if (!states.has(chatId)) return
      cancelPendingFlush(chatId)
      states.delete(chatId)
      emit({ type: "removed", chatId })
    },
  }
}
