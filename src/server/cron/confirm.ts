import { log } from "../../shared/log"
import { toError } from "../../shared/errors"
import { formatCronConfirmRequest } from "../../shared/cron/confirm-report"
import type { CronArmSummary } from "../../shared/cron/types"

export interface CronConfirmEnqueueOptions {
  autoContinue?: { scheduleId: string }
}

export interface CronConfirmDeps {
  enabled: boolean
  hasQueuedMessage: (chatId: string) => boolean
  enqueueMessage: (
    chatId: string,
    content: string,
    options?: CronConfirmEnqueueOptions,
  ) => Promise<void>
  drainQueue: (chatId: string) => Promise<void>
}

export interface CronConfirm {
  offer: (chatId: string, jobId: string, summary: CronArmSummary) => Promise<void>
}

const CONFIRMED_MEMORY_PER_CHAT = 32

function remember(seen: Set<string>, jobId: string): void {
  seen.add(jobId)
  while (seen.size > CONFIRMED_MEMORY_PER_CHAT) {
    const oldest = seen.values().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
}

export function createCronConfirm(deps: CronConfirmDeps): CronConfirm {
  const confirmedByChat = new Map<string, Set<string>>()

  return {
    offer: async (chatId, jobId, summary) => {
      if (!deps.enabled) return
      if (deps.hasQueuedMessage(chatId)) return

      const confirmed = confirmedByChat.get(chatId) ?? new Set<string>()
      confirmedByChat.set(chatId, confirmed)
      if (confirmed.has(jobId)) return
      remember(confirmed, jobId)

      try {
        log.info("[kanna/cron] asking the model to confirm a typed /cron arm", { chatId, jobId })
        await deps.enqueueMessage(chatId, formatCronConfirmRequest(summary), {
          autoContinue: { scheduleId: `cron-confirm-${jobId}` },
        })
        await deps.drainQueue(chatId)
      } catch (confirmError) {
        log.warn("[kanna/cron] confirm offer failed", {
          chatId,
          message: toError(confirmError).message,
        })
      }
    },
  }
}
