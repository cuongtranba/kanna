/**
 * Next-occurrence math for cron schedules.
 *
 * Cron-type schedules delegate to the `cron` package (kelektiv/node-cron) —
 * its `CronTime.getNextDateFrom` is the single authority for calendar
 * semantics: the vixie day-of-month/day-of-week OR rule, DST shifts, month
 * lengths, leap years. Verified behaviors this module relies on:
 * - strictly-after: an exactly-matching `from` returns the NEXT slot, so a
 *   just-fired job can never compute its own fire time again;
 * - an impossible schedule (`0 0 30 2 *`, Feb 30) throws after a bounded
 *   search — mapped to null so arm-time validation refuses it.
 *
 * Interval schedules (`every Nm` sugar) are plain arithmetic on the arm-time
 * anchor grid: fires land on `anchor + k * ms`, which node-cron cannot
 * express (its expressions snap to the calendar).
 *
 * Server-only on purpose: the client never computes occurrences (it renders
 * the server-computed `nextFireAt`), so luxon stays out of the bundle.
 */

import { CronTime } from "cron"
import type { CronSchedule } from "../../shared/cron/types"

/**
 * The earliest fire time strictly after `fromMs`, or null when the schedule
 * has no future occurrence. `anchorMs` only matters for interval schedules
 * (the arm moment; first fire is one full interval after it).
 */
export function nextFireAt(schedule: CronSchedule, fromMs: number, anchorMs: number): number | null {
  if (schedule.type === "interval") {
    if (fromMs < anchorMs) return anchorMs + schedule.ms
    const steps = Math.floor((fromMs - anchorMs) / schedule.ms) + 1
    return anchorMs + steps * schedule.ms
  }

  try {
    return new CronTime(schedule.expression).getNextDateFrom(new Date(fromMs)).toMillis()
  } catch {
    // CronTime throws when no execution date exists in its search window.
    return null
  }
}
