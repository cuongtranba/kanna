import type { CronMode, CronSchedule, CronSkipReason } from "../../shared/cron/types"

export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

export type AutoContinueSource =
  | "user"
  | "auto_setting"
  | "token_rotation"
  | "subagent_background"

export interface ChatAutomationEventBase {
  v: typeof AUTO_CONTINUE_EVENT_VERSION
  timestamp: number
  chatId: string
  scheduleId: string
}

export type AutoContinueScheduleEvent =
  | (ChatAutomationEventBase & {
      kind: "auto_continue_proposed"
      detectedAt: number
      resetAt: number
      tz: string
    })
  | (ChatAutomationEventBase & {
      kind: "auto_continue_accepted"
      scheduledAt: number
      tz: string
      source: AutoContinueSource
      resetAt: number
      detectedAt: number
      prompt?: string
    })
  | (ChatAutomationEventBase & {
      kind: "auto_continue_rescheduled"
      scheduledAt: number
    })
  | (ChatAutomationEventBase & {
      kind: "auto_continue_cancelled"
      reason: "user" | "chat_deleted"
    })
  | (ChatAutomationEventBase & {
      kind: "auto_continue_fired"
    })

export type LoopLifecycleEvent =
  | (ChatAutomationEventBase & {
      kind: "loop_armed"
      subagentId: string
      prompt: string
      verifyCommand?: string
      workdirAbs?: string
      trackingFileRel?: string
      parallelism?: number
    })
  | (ChatAutomationEventBase & {
      kind: "loop_run_outcome"
      ok: boolean
      errorCode?: string
    })
  | (ChatAutomationEventBase & {
      kind: "loop_disarmed"
      reason: "goal_met" | "user_send" | "chat_deleted" | "repeated_failures"
    })

export type CronEvent =
  | (ChatAutomationEventBase & {
      kind: "cron_armed"
      instruction: string
      mode: CronMode
      scheduleText: string
      schedule: CronSchedule
      model?: string
      paused?: boolean
    })
  | (ChatAutomationEventBase & {
      kind: "cron_disarmed"
      reason: "user" | "chat_deleted"
    })
  | (ChatAutomationEventBase & {
      kind: "cron_paused"
    })
  | (ChatAutomationEventBase & {
      kind: "cron_resumed"
    })
  | (ChatAutomationEventBase & {
      kind: "cron_run_started"
      runId: string
      spawnedChatId?: string
    })
  | (ChatAutomationEventBase & {
      kind: "cron_run_outcome"
      runId: string
      ok: boolean
      errorCode?: string
    })
  | (ChatAutomationEventBase & {
      kind: "cron_run_skipped"
      reason: CronSkipReason
      missedCount?: number
    })

export type ChatAutomationEvent = AutoContinueScheduleEvent | LoopLifecycleEvent | CronEvent

export function isAutoContinueScheduleEvent(
  event: ChatAutomationEvent,
): event is AutoContinueScheduleEvent {
  return event.kind.startsWith("auto_continue_")
}

export function chatAutomationEnvelope(
  chatId: string,
  scheduleId: string,
  timestamp: number,
): ChatAutomationEventBase {
  return { v: AUTO_CONTINUE_EVENT_VERSION, timestamp, chatId, scheduleId }
}
