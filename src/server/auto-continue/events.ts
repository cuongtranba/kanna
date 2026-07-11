export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

/**
 * Why a schedule was accepted.
 *  - `user` / `auto_setting` / `token_rotation` — provider-failure resume
 *    (rate-limit, auth-error). Fire the literal `"continue"`.
 *  - `subagent_background` — a `run_in_background` subagent finished; re-enter
 *    to deliver a minimal "Read PROGRESS.md, decide next action" prompt after
 *    Kanna wipes the main-agent Claude session (per-iteration /clear). See
 *    adr-2026XXXX-notification-driven-loop-orchestration.
 *
 * Removed in adr-2026XXXX (hard break):
 *  - `agent_wakeup` — timer-based `schedule_wakeup` self-poll (loop lost momentum
 *    on compaction; replaced by notification-driven `delegate_subagent` pattern).
 *  - `pending_workflow` — workflow-harvest poll (deferred to a follow-up ADR;
 *    model can `delegate_subagent` to a status-check subagent for event-driven
 *    workflow wake).
 */
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
      /**
       * Prompt to replay when this schedule fires. Present only for
       * `subagent_background` deliveries; provider-failure schedules omit it
       * and fire the literal `"continue"`.
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
