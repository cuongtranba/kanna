export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

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
      source: "user" | "auto_setting" | "token_rotation"
      resetAt: number
      detectedAt: number
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
