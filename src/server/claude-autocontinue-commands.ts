
import type { ChatAttachment, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { deriveChatSchedules } from "./auto-continue/read-model"
import type { SendMessageOptions } from "./claude-steer-log"
import { timestamped } from "./claude-message-normalizer"
import { addCounter } from "./observability"


interface AutoContinueScheduleManager {
  onEvent(event: AutoContinueEvent): void
}

interface AutoContinueCommandStore {
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  getChat(chatId: string): { id: string } | null | undefined
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}


export interface AutoContinueCommandDeps {
  autoResumeByChat: Pick<Map<string, boolean>, "get">

  getAutoResumePreference(): boolean

  store: AutoContinueCommandStore

  scheduleManager: AutoContinueScheduleManager | null

  emitStateChange(chatId: string): void

  enqueueMessage(
    chatId: string,
    content: string,
    attachments: ChatAttachment[],
    options?: SendMessageOptions,
  ): Promise<QueuedChatMessage>

  maybeStartNextQueuedMessage(chatId: string): Promise<boolean>
}


export function resolveAutoResumeFor(deps: AutoContinueCommandDeps, chatId: string): boolean {
  const cached = deps.autoResumeByChat.get(chatId)
  if (typeof cached === "boolean") return cached
  return deps.getAutoResumePreference()
}

export async function emitAutoContinueEvent(
  deps: AutoContinueCommandDeps,
  event: AutoContinueEvent,
): Promise<void> {
  await deps.store.appendAutoContinueEvent(event)
  deps.scheduleManager?.onEvent(event)
  deps.emitStateChange(event.chatId)
}

export function getChatSchedule(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
) {
  const events = deps.store.getAutoContinueEvents(chatId)
  return deriveChatSchedules(events, chatId).schedules[scheduleId]
}

export function requireFuture(scheduledAt: number): void {
  if (scheduledAt <= Date.now()) throw new Error("scheduledAt must be in the future")
}

export async function fireAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
): Promise<void> {
  if (!deps.store.getChat(chatId)) return

  const schedule = getChatSchedule(deps, chatId, scheduleId)
  const promptToReplay = schedule?.prompt ?? "continue"

  const event: AutoContinueEvent = {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_fired",
    timestamp: Date.now(),
    chatId,
    scheduleId,
  }
  try {
    await deps.store.appendAutoContinueEvent(event)
    await deps.enqueueMessage(chatId, promptToReplay, [], { autoContinue: { scheduleId } })
    await deps.maybeStartNextQueuedMessage(chatId)
    addCounter("kanna.autocontinue.fired", 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.store.appendMessage(
      chatId,
      timestamped({
        kind: "result",
        subtype: "error",
        isError: true,
        durationMs: 0,
        result: `Auto-continue failed: ${message}`,
      }),
    )
  }

  deps.emitStateChange(chatId)
}

export async function acceptAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  scheduledAt: number,
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule) throw new Error("Schedule not found")
  if (schedule.state !== "proposed") throw new Error("Schedule not pending")
  requireFuture(scheduledAt)

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_accepted",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    scheduledAt,
    tz: schedule.tz,
    source: "user",
    resetAt: schedule.resetAt,
    detectedAt: schedule.detectedAt,
  })
}

export async function rescheduleAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  scheduledAt: number,
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule || schedule.state !== "scheduled") throw new Error("Schedule not active")
  requireFuture(scheduledAt)

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_rescheduled",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    scheduledAt,
  })
}

export async function cancelAutoContinue(
  deps: AutoContinueCommandDeps,
  chatId: string,
  scheduleId: string,
  reason: "user" | "chat_deleted",
): Promise<void> {
  const schedule = getChatSchedule(deps, chatId, scheduleId)
  if (!schedule) return
  if (schedule.state !== "proposed" && schedule.state !== "scheduled") return

  await emitAutoContinueEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_cancelled",
    timestamp: Date.now(),
    chatId,
    scheduleId,
    reason,
  })
}
