/**
 * Human-readable schedule descriptions for the cron cards and panels.
 * Covers the common shapes; anything irregular falls back to the schedule
 * text exactly as the user typed it.
 */

import type { CronField, CronSchedule } from "./types"

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function humanizeSchedule(schedule: CronSchedule, scheduleText: string): string {
  if (schedule.type === "interval") {
    const minutes = schedule.ms / 60_000
    if (minutes % 60 === 0) {
      const hours = minutes / 60
      return hours === 1 ? "every hour" : `every ${hours} hours`
    }
    return minutes === 1 ? "every minute" : `every ${minutes} minutes`
  }

  const { minute, hour, dom, month, dow } = schedule
  if (month.kind !== "any") return scheduleText

  const minuteValue = singleValue(minute)
  const hourValue = singleValue(hour)

  if (minute.kind === "any" && hour.kind === "any" && dom.kind === "any" && dow.kind === "any") {
    return "every minute"
  }

  if (minuteValue !== null && hour.kind === "any" && dom.kind === "any" && dow.kind === "any") {
    return `hourly at :${pad(minuteValue)}`
  }

  if (minuteValue !== null && hourValue !== null) {
    const time = `${pad(hourValue)}:${pad(minuteValue)}`
    if (dom.kind === "any" && dow.kind === "any") return `daily at ${time}`
    if (dom.kind === "any" && dow.kind === "values") {
      const days = dow.values.map((value) => DOW_LABELS[value]).join(", ")
      return `every ${days} at ${time}`
    }
    if (dow.kind === "any" && dom.kind === "values" && dom.values.length === 1) {
      return `on day ${dom.values[0]} of each month at ${time}`
    }
  }

  return scheduleText
}

function singleValue(field: CronField): number | null {
  return field.kind === "values" && field.values.length === 1 ? field.values[0]! : null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}
