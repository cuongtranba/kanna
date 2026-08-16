/**
 * Human-readable schedule descriptions for the cron cards and panels.
 * Covers the common shapes; anything irregular falls back to the schedule
 * text exactly as the user typed it.
 */

import type { CronField, CronSchedule } from "./types"

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function humanizeSchedule(schedule: CronSchedule, scheduleText: string): string {
  if (schedule.type === "interval") return humanizeInterval(schedule.ms)

  const { second, minute, hour, dom, month, dow } = schedule
  if (month.kind !== "any") return scheduleText

  const everyDay = dom.kind === "any" && dow.kind === "any"

  // A 6-field expression whose seconds field carries the cadence: the whole
  // schedule reads in seconds and no time-of-day phrasing applies.
  if (second !== undefined && minute.kind === "any" && hour.kind === "any" && everyDay) {
    if (second.kind === "any") return "every second"
    const step = evenStep(second.values)
    if (step !== null) return step === 1 ? "every second" : `every ${step} seconds`
    // An arbitrary list is no cadence; a single value is an instant, and falls
    // through to the time-of-day shapes below.
    if (second.values.length > 1) return scheduleText
  }

  // Below here a seconds field, when present, must pin ONE instant in the
  // minute — anything else is a cadence the time-of-day shapes cannot state.
  const secondValue = second === undefined ? 0 : singleValue(second)
  if (secondValue === null) return scheduleText
  const secondSuffix = secondValue === 0 ? "" : `:${pad(secondValue)}`

  const minuteValue = singleValue(minute)
  const hourValue = singleValue(hour)

  if (minute.kind === "any" && hour.kind === "any" && everyDay) {
    return secondValue === 0 ? "every minute" : `every minute at :${pad(secondValue)}`
  }

  if (minuteValue !== null && hour.kind === "any" && everyDay) {
    return `hourly at :${pad(minuteValue)}${secondSuffix}`
  }

  if (minuteValue !== null && hourValue !== null) {
    const time = `${pad(hourValue)}:${pad(minuteValue)}${secondSuffix}`
    if (everyDay) return `daily at ${time}`
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

/** Reads in the largest unit the interval divides into evenly. */
function humanizeInterval(ms: number): string {
  const seconds = Math.round(ms / 1_000)
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600
    return hours === 1 ? "every hour" : `every ${hours} hours`
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? "every minute" : `every ${minutes} minutes`
  }
  return seconds === 1 ? "every second" : `every ${seconds} seconds`
}

function singleValue(field: CronField): number | null {
  return field.kind === "values" && field.values.length === 1 ? field.values[0]! : null
}

/**
 * The step a star-slash-N field expanded from, recovered from its flattened
 * value set: evenly spaced, starting at 0, and covering the whole minute.
 * Returns null for an arbitrary list, which has no one-word cadence.
 */
function evenStep(values: readonly number[]): number | null {
  if (values.length < 2 || values[0] !== 0) return null
  const step = values[1]!
  if (step < 1 || 60 % step !== 0 || values.length !== 60 / step) return null
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== i * step) return null
  }
  return step
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}
