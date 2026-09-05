import { log } from "../shared/log"
import { toError } from "../shared/errors"

export interface ModelEscalationEnqueueOptions {
  autoContinue?: { scheduleId: string }
}

export interface ModelEscalationConfig {
  name: string
  enabled: boolean
  hasQueuedMessage: (chatId: string) => boolean
  enqueueMessage: (
    chatId: string,
    content: string,
    options?: ModelEscalationEnqueueOptions,
  ) => Promise<void>
  drainQueue?: (chatId: string) => Promise<void>
  memoryPerChat?: number
}

export interface ModelEscalation {
  offer(chatId: string, key: string, prompt: string, scheduleId: string): Promise<void>
  forget(chatId: string): void
}

const DEFAULT_MEMORY_PER_CHAT = 32

export function createModelEscalation(deps: ModelEscalationConfig): ModelEscalation {
  const cap = deps.memoryPerChat ?? DEFAULT_MEMORY_PER_CHAT
  const seenByChat = new Map<string, Set<string>>()

  function remember(seen: Set<string>, key: string): void {
    seen.add(key)
    while (seen.size > cap) {
      const oldest = seen.values().next().value
      if (oldest === undefined) break
      seen.delete(oldest)
    }
  }

  return {
    offer: async (chatId, key, prompt, scheduleId) => {
      if (!deps.enabled) return
      if (deps.hasQueuedMessage(chatId)) return

      const seen = seenByChat.get(chatId) ?? new Set<string>()
      seenByChat.set(chatId, seen)
      if (seen.has(key)) return
      remember(seen, key)

      try {
        log.info(`[kanna/${deps.name}] escalating to model`, { chatId, key })
        await deps.enqueueMessage(chatId, prompt, { autoContinue: { scheduleId } })
        await deps.drainQueue?.(chatId)
      } catch (error) {
        log.warn(`[kanna/${deps.name}] escalation failed`, {
          chatId,
          message: toError(error).message,
        })
      }
    },

    forget: (chatId) => {
      seenByChat.delete(chatId)
    },
  }
}
