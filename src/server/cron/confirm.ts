import { formatCronConfirmRequest } from "../../shared/cron/confirm-report"
import type { CronArmSummary } from "../../shared/cron/types"
import type { ModelEscalation } from "../model-escalation"

export interface CronConfirmDeps {
  escalation: ModelEscalation
}

export interface CronConfirm {
  offer: (chatId: string, jobId: string, summary: CronArmSummary) => Promise<void>
}

export function createCronConfirm(deps: CronConfirmDeps): CronConfirm {
  return {
    offer: async (chatId, jobId, summary) => {
      await deps.escalation.offer(
        chatId,
        jobId,
        formatCronConfirmRequest(summary),
        `cron-confirm-${jobId}`,
      )
    },
  }
}
