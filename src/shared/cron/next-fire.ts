/**
 * Next-occurrence math for cron schedules. All calendar math runs in the
 * process-local timezone via `Date` field getters/setters — a Kanna cron
 * fires on server-local wall-clock time (per-job timezones are a non-goal).
 *
 * The search walks the calendar coarsest-field-first (month → day → hour →
 * minute) so an impossible schedule costs a bounded number of day steps, and
 * is capped at 4 years: a schedule with no occurrence inside the window
 * (e.g. `0 0 30 2 *`, Feb 30) returns null so arm-time validation can refuse
 * it instead of arming a job that never fires.
 */

import type { CronField, CronSchedule } from "./types"

const MAX_SEARCH_YEARS = 4

/**
 * The earliest fire time strictly after `fromMs`, or null when the schedule
 * never fires inside the search window.
 *
 * `anchorMs` only matters for interval schedules: fires land on
 * `anchor + k * ms` (the arm moment being the anchor, so the first fire is
 * one full interval after arming).
 */
export function nextFireAt(schedule: CronSchedule, fromMs: number, anchorMs: number): number | null {
  if (schedule.type === "interval") {
    if (fromMs < anchorMs) return anchorMs + schedule.ms
    const steps = Math.floor((fromMs - anchorMs) / schedule.ms) + 1
    return anchorMs + steps * schedule.ms
  }

  const limit = new Date(fromMs)
  limit.setFullYear(limit.getFullYear() + MAX_SEARCH_YEARS)
  const limitMs = limit.getTime()

  const candidate = new Date(fromMs)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  while (candidate.getTime() <= limitMs) {
    if (!matchesField(schedule.month, candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(schedule, candidate)) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      continue
    }
    if (!matchesField(schedule.hour, candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!matchesField(schedule.minute, candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
      continue
    }
    return candidate.getTime()
  }
  return null
}

function matchesField(field: CronField, value: number): boolean {
  if (field.kind === "any") return true
  return field.values.includes(value)
}

/**
 * Vixie day rule: the restricted flags only pick OR vs AND — the field
 * VALUES always apply (a stepped dom field — star with a `/2` step — is
 * "unrestricted" for the rule yet still constrains the day). Both dom and
 * dow restricted → EITHER may match (OR);
 * otherwise BOTH must match, an `any` field trivially matching every day.
 */
function dayMatches(schedule: Extract<CronSchedule, { type: "cron" }>, date: Date): boolean {
  const domOk = matchesField(schedule.dom, date.getDate())
  const dowOk = matchesField(schedule.dow, date.getDay())
  if (schedule.domRestricted && schedule.dowRestricted) return domOk || dowOk
  return domOk && dowOk
}
