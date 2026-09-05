import type { CronMode, CronSchedule, CronSkipReason } from "../../shared/cron/types"

export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

export type AutoContinueSource =
  | "user"
  | "auto_setting"
  | "token_rotation"
  | "subagent_background"

interface AutoContinueEventBase {
  v: typeof AUTO_CONTINUE_EVENT_VERSION
  timestamp: number
  chatId: string
  scheduleId: string
}

export type AutoContinueEvent =
  | (AutoContinueEventBase & {
      kind: "auto_continue_proposed"
      detectedAt: number
      resetAt: number
      tz: string
    })
  | (AutoContinueEventBase & {
      kind: "auto_continue_accepted"
      scheduledAt: number
      tz: string
      source: AutoContinueSource
      resetAt: number
      detectedAt: number
      prompt?: string
    })
  | (AutoContinueEventBase & {
      kind: "auto_continue_rescheduled"
      scheduledAt: number
    })
  | (AutoContinueEventBase & {
      kind: "auto_continue_cancelled"
      reason: "user" | "chat_deleted"
    })
  | (AutoContinueEventBase & {
      kind: "auto_continue_fired"
    })
  | (AutoContinueEventBase & {
      kind: "loop_armed"
      subagentId: string
      prompt: string
      verifyCommand?: string
      workdirAbs?: string
      trackingFileRel?: string
    })
  | (AutoContinueEventBase & {
      kind: "loop_run_outcome"
      ok: boolean
      errorCode?: string
    })
  | (AutoContinueEventBase & {
      kind: "loop_disarmed"
      reason: "goal_met" | "user_send" | "chat_deleted" | "repeated_failures"
    })
  | (AutoContinueEventBase & {
      kind: "cron_armed"
      instruction: string
      mode: CronMode
      scheduleText: string
      schedule: CronSchedule
      model?: string
      paused?: boolean
    })
  | (AutoContinueEventBase & {
      kind: "cron_disarmed"
      reason: "user" | "chat_deleted"
    })
  | (AutoContinueEventBase & {
      kind: "cron_paused"
    })
  | (AutoContinueEventBase & {
      kind: "cron_resumed"
    })
  | (AutoContinueEventBase & {
      kind: "cron_run_started"
      runId: string
      spawnedChatId?: string
    })
  | (AutoContinueEventBase & {
      kind: "cron_run_outcome"
      runId: string
      ok: boolean
      errorCode?: string
    })
  | (AutoContinueEventBase & {
      kind: "cron_run_skipped"
      reason: CronSkipReason
      missedCount?: number
    })
