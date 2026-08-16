import type { CronMode, CronSchedule, CronSkipReason } from "../../shared/cron/types"

export const AUTO_CONTINUE_EVENT_VERSION = 3 as const

/**
 * Why a schedule was accepted.
 *  - `user` / `auto_setting` / `token_rotation` — provider-failure resume
 *    (rate-limit, auth-error). Fire the literal `"continue"`.
 *  - `subagent_background` — a `run_in_background` subagent finished; re-enter
 *    to deliver a minimal "Read PROGRESS.md, decide next action" prompt after
 *    Kanna wipes the main-agent Claude session (per-iteration /clear). See
 *    adr-20260711-notification-driven-loop-orchestration.
 *
 * Removed in adr-20260711-notification-driven-loop-orchestration (hard break):
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
       * Prompt to replay when this schedule fires. Present for
       * `subagent_background` deliveries and for armed-loop rate-limit
       * deferrals (the full loop prompt); plain provider-failure schedules
       * omit it and fire the literal `"continue"`.
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
  | (AutoContinueEventBase & {
      /**
       * A `setup_loop` armed an autonomous loop on this chat. Persists the
       * resolved worker + rendered loop prompt so every subsequent
       * background-completion wake re-injects the loop discipline (rather than
       * the generic "decide next action" prompt) and so loop turns can be
       * tool-blocked at the host. Superseded by a later `loop_armed` or
       * cleared by `loop_disarmed`. See adr-20260712-loop-orchestration-hardening.
       */
      kind: "loop_armed"
      subagentId: string
      prompt: string
      /**
       * The oracle + where it runs. Optional because events persisted before
       * these fields existed replay without them; `run_verify` then refuses
       * and asks for a re-arm rather than guessing a command to execute.
       */
      verifyCommand?: string
      workdirAbs?: string
      /**
       * Tracking file, relative to `workdirAbs`. Lets the host read the plan's
       * `## Next chunk` at delegate time and label the Progress row with the
       * chunk being worked. Optional for the same replay reason as above.
       */
      trackingFileRel?: string
    })
  | (AutoContinueEventBase & {
      /**
       * Outcome of one delegated loop iteration, recorded so the host can see
       * a loop failing repeatedly and disarm it itself.
       *
       * Without this the only backstop was the model's judgement, and a single
       * transient `AUTH_REQUIRED` was enough to make it call `stop_loop` and
       * park the run until a human noticed. `deriveLoopState` folds these into
       * `consecutiveFailures`; a success resets the count.
       */
      kind: "loop_run_outcome"
      ok: boolean
      errorCode?: string
    })
  | (AutoContinueEventBase & {
      kind: "loop_disarmed"
      reason: "goal_met" | "user_send" | "chat_deleted" | "repeated_failures"
    })
  /*
   * Cron events. `scheduleId` doubles as the cron JOB id (the same trick
   * `loop_armed` plays), so the base shape carries job identity for free.
   * Run events additionally carry their own `runId` — one job fires many
   * runs. Timers live in `CronScheduler`, never `ScheduleManager`; these
   * events are its durable state, replayed on boot.
   */
  | (AutoContinueEventBase & {
      /** `/cron` armed a job. A later `cron_armed` with the same id replaces it. */
      kind: "cron_armed"
      instruction: string
      mode: CronMode
      scheduleText: string
      schedule: CronSchedule
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
      /** Present in spawn mode: the chat this run executes in. */
      spawnedChatId?: string
    })
  | (AutoContinueEventBase & {
      kind: "cron_run_outcome"
      runId: string
      ok: boolean
      errorCode?: string
    })
  | (AutoContinueEventBase & {
      /**
       * A tick that did not run: the arming chat (inline) or the job's own
       * previous run was still busy, or fires were missed while the server
       * was down (`server_offline`, with how many were skipped).
       */
      kind: "cron_run_skipped"
      reason: CronSkipReason
      missedCount?: number
    })
