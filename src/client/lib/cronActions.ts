import { pendingActionKey } from "../stores/pendingActionsStore"

export type CronJobActionType = "cron.pause" | "cron.resume" | "cron.remove"

export function cronActionKey(type: CronJobActionType, chatId: string, jobId: string): string {
  return pendingActionKey(type, chatId, jobId)
}
