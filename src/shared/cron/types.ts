/**
 * Cron feature domain types — pure, shared between server and client.
 *
 * A cron job is armed from a chat via the `/cron` builtin command and fires
 * on a schedule. Two run modes:
 * - `inline`: every fire runs in the arming chat itself; the chat's context
 *   is cleared before each run so every cycle starts fresh and the chat
 *   becomes a monitoring view.
 * - `spawn`: every fire creates a brand-new chat and runs there; the arming
 *   chat collects one run card per fire.
 */

export type CronMode = "inline" | "spawn"

export const CRON_MODES: readonly CronMode[] = ["inline", "spawn"]

export function isCronMode(token: string): token is CronMode {
  return token === "inline" || token === "spawn"
}

/**
 * One parsed cron field, post-expansion: ranges, steps and lists are
 * flattened to the concrete sorted value set. `any` is a plain `*`.
 */
export type CronField = { kind: "any" } | { kind: "values"; values: readonly number[] }

/**
 * A normalized schedule. `every Nm` sugar stays an interval — it anchors at
 * arm time (`every 7m` = every 7 minutes from arming), which is NOT the same
 * as the star-slash-7 cron minute field (that snaps to the hour) — so it is
 * deliberately not rewritten to cron fields.
 */
export type CronSchedule =
  | {
      type: "cron"
      minute: CronField
      hour: CronField
      dom: CronField
      month: CronField
      dow: CronField
      /**
       * Vixie-cron day-matching rule: a dom/dow field whose raw text starts
       * with `*` is "unrestricted". When BOTH dom and dow are restricted the
       * day matches when EITHER matches (OR); otherwise both apply (AND,
       * where an unrestricted field matches every day).
       */
      domRestricted: boolean
      dowRestricted: boolean
    }
  | { type: "interval"; ms: number }

/** Which part of a `/cron` line failed validation. */
export type CronParsePart =
  | "subcommand"
  | "instruction"
  | "mode"
  | "schedule"
  | "schedule_field"

export interface CronParseError {
  part: CronParsePart
  message: string
  /**
   * A complete, ready-to-send corrected `/cron …` line. Only present when a
   * correction is unambiguous; every suggestion is guaranteed to re-parse
   * cleanly (drift guard in the colocated test).
   */
  suggestion?: string
}

export type CronCommand =
  | { sub: "help" }
  | { sub: "list" }
  | { sub: "remove"; jobId: string }
  | { sub: "pause"; jobId: string }
  | { sub: "resume"; jobId: string }
  | {
      sub: "arm"
      instruction: string
      mode: CronMode
      schedule: CronSchedule
      /** The schedule exactly as the user typed it, for display. */
      scheduleText: string
    }

export type CronParseResult =
  | { ok: true; command: CronCommand }
  | { ok: false; error: CronParseError }

/** Why a scheduled tick was skipped instead of run. */
export type CronSkipReason = "chat_busy" | "previous_run_active" | "server_offline"

export type CronRunStatus = "running" | "completed" | "failed" | "skipped"

export interface CronRunSnapshot {
  runId: string
  firedAt: number
  status: CronRunStatus
  /** Spawn mode: the chat this run executed in. */
  spawnedChatId?: string
  skipReason?: CronSkipReason
  /** For `server_offline` skips: how many fires were missed. */
  missedCount?: number
  errorCode?: string
}

/**
 * One armed cron job, projected from the auto-continue event log. Flows
 * server → client on `ChatSnapshot.cronJobs` (per-chat footer panel, run-card
 * status joins) and on the global cron-jobs topic (management page).
 */
export interface CronJobSnapshot {
  jobId: string
  instruction: string
  mode: CronMode
  scheduleText: string
  schedule: CronSchedule
  paused: boolean
  armedAt: number
  /** Next fire time, or null when paused or the schedule has no future occurrence. */
  nextFireAt: number | null
  lastRun: CronRunSnapshot | null
  /** Newest first, bounded (`MAX_RECENT_CRON_RUNS`). */
  recentRuns: readonly CronRunSnapshot[]
}

export const MAX_RECENT_CRON_RUNS = 20
