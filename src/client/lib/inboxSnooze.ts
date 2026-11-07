import type { InboxStateDisplay } from "./inboxPresentation"
import { startOfDay } from "./inboxFilter"

const HOUR_MS = 60 * 60 * 1000
const LATER_TODAY_HOURS = 3
const MORNING_HOUR = 9
const MONDAY = 1
const DAYS_PER_WEEK = 7
const NEXT_WEEKDAY_DAYS = 6

export type SnoozePresetId = "laterToday" | "tomorrow" | "nextWeek"

export interface SnoozePreset {
  id: SnoozePresetId
  label: string
  until: number
}

function morningOf(now: number, daysAhead: number): number {
  const day = new Date(startOfDay(now))
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + daysAhead, MORNING_HOUR).getTime()
}

function daysUntilNextMonday(now: number): number {
  const weekday = new Date(now).getDay()
  return ((MONDAY - weekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK) + 1
}

export function snoozePresets(now: number): readonly SnoozePreset[] {
  return [
    { id: "laterToday", label: "Later today", until: now + LATER_TODAY_HOURS * HOUR_MS },
    { id: "tomorrow", label: "Tomorrow", until: morningOf(now, 1) },
    { id: "nextWeek", label: "Next week", until: morningOf(now, daysUntilNextMonday(now)) },
  ]
}

export function parseSnoozeInput(value: string, now: number): number | null {
  if (value.length === 0) return null
  const until = new Date(value).getTime()
  return Number.isFinite(until) && until > now ? until : null
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }

export function formatSnoozeUntil(until: number, now: number): string {
  const time = new Date(until).toLocaleTimeString(undefined, TIME_FORMAT)
  const daysAhead = Math.round((startOfDay(until) - startOfDay(now)) / (24 * HOUR_MS))
  if (daysAhead <= 0) return time
  if (daysAhead === 1) return `tomorrow ${time}`
  const weekday = new Date(until).toLocaleDateString(undefined, { weekday: "short" })
  if (daysAhead <= NEXT_WEEKDAY_DAYS) return `${weekday} ${time}`
  const date = new Date(until).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `${weekday}, ${date} ${time}`
}

export function snoozedDisplay(until: number, now: number): InboxStateDisplay {
  return { tone: "muted", label: `Until ${formatSnoozeUntil(until, now)}` }
}
