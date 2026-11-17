import { isAutoContinueScheduleEvent } from "./auto-continue/events"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import type { AgentCoordinator } from "./agent-coordinator"
import type { CronScheduler } from "./cron/scheduler"
import type { EventStore } from "./event-store"
import { recoverQueuedMessages } from "./queued-message-recovery"
import { log } from "../shared/log"

export function rehydrateScheduledWork(services: {
  store: EventStore
  agent: AgentCoordinator
  scheduleManager: ScheduleManager
  cronScheduler: CronScheduler
}): void {
  const { store, agent, scheduleManager, cronScheduler } = services
  scheduleManager.rehydrate(
    store
      .listAutoContinueChats()
      .flatMap((chatId) => store.getAutoContinueEvents(chatId))
      .filter(isAutoContinueScheduleEvent),
  )
  const cronChatIds = store.listAutoContinueChats()
  const missedCronFires = cronScheduler.rehydrate(
    cronChatIds.flatMap((chatId) => store.getAutoContinueEvents(chatId)),
  )
  void agent.reconcileCronRunsAtBoot(missedCronFires, cronChatIds).catch((error) => {
    log.error("[kanna/cron] boot reconciliation failed:", String(error))
  })

  void recoverQueuedMessages({
    listChatsWithQueuedMessages: () => store.listChatsWithQueuedMessages(),
    maybeStartNextQueuedMessage: (chatId, opts) => agent.maybeStartNextQueuedMessage(chatId, opts),
  }).then(async (recovered) => {
    if (recovered.length > 0) {
      log.info("[kanna] resumed queued messages after restart", { chats: recovered.length })
    }
    const rearmed = await agent.recoverArmedLoopWakes()
    if (rearmed.length > 0) {
      log.info("[kanna] re-fired lost loop wakes after restart", { chats: rearmed.length })
    }
  })
}
