export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

/**
 * Why a schedule was accepted.
 *  - `user` / `auto_setting` / `token_rotation` — provider-failure resume
 *    (rate-limit, auth-error). Fire the literal `"continue"`.
 *  - `agent_wakeup` — the model called `ScheduleWakeup`; replay its prompt.
 *  - `pending_workflow` — turn ended with a background Workflow still running;
 *    re-enter to harvest results.
 *  - `subagent_background` — a `run_in_background` subagent finished; re-enter
 *    to deliver its reply. Exempt from the runaway-wake cap (result delivery,
 *    not a self-poll). See adr-20260616-subagent-run-in-background.
 *  - `interrupted_resume` — a turn that did not finish before the server
 *    stopped (crash or graceful deploy); re-enter on next boot to continue it.
 *    Exempt from the runaway-wake cap (bounded instead by the per-turn resume
 *    attempt cap). See turn-recovery.
 */
export type AutoContinueSource =
  | "user"
  | "auto_setting"
  | "token_rotation"
  | "agent_wakeup"
  | "pending_workflow"
  | "subagent_background"
  | "interrupted_resume"

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
      /**
       * Prompt to replay when this schedule fires. Present only for
       * agent-driven wakes (`agent_wakeup`, `pending_workflow`); provider-
       * failure schedules omit it and fire the literal `"continue"`.
       */
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
