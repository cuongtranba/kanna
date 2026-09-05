
import { CronTime } from "cron"
import type { CronSchedule } from "../../shared/cron/types"

export function nextFireAt(schedule: CronSchedule, fromMs: number, anchorMs: number): number | null {
  if (schedule.type === "interval") {
    if (fromMs < anchorMs) return anchorMs + schedule.ms
    const steps = Math.floor((fromMs - anchorMs) / schedule.ms) + 1
    return anchorMs + steps * schedule.ms
  }

  try {
    return new CronTime(schedule.expression).getNextDateFrom(new Date(fromMs)).toMillis()
  } catch {
    return null
  }
}
