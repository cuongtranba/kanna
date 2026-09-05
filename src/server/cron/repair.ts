
import { formatCronRepairRequest } from "../../shared/cron/repair-report"
import type { CronParseError, CronParsePart } from "../../shared/cron/types"
import type { ModelEscalation } from "../model-escalation"

const REPAIRABLE_PARTS: readonly CronParsePart[] = [
  "instruction",
  "mode",
  "schedule",
  "schedule_field",
  "multiline",
]

export interface CronRepairDeps {
  escalation: ModelEscalation
}

export interface CronRepair {
  offer: (chatId: string, error: CronParseError) => Promise<void>
}

export function createCronRepair(deps: CronRepairDeps): CronRepair {
  return {
    offer: async (chatId, error) => {
      if (error.suggestion !== undefined) return
      if (!REPAIRABLE_PARTS.includes(error.part)) return
      await deps.escalation.offer(
        chatId,
        error.input,
        formatCronRepairRequest(error),
        `cron-repair-${error.part}`,
      )
    },
  }
}
