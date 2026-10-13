import type { ChatActivity } from "./types"

export function chatHasPendingWork(activity: ChatActivity): boolean {
  return activity.backgroundTasks > 0
    || activity.agents > 0
    || activity.workflow !== null
    || activity.loop !== null
}
