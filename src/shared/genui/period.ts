import type { JsonValue } from "../json"
import type { TimeGrain } from "./datasets"
import { oneOf } from "../vocab"

export interface TimePoint {
  year: number
  month: number
  day: number
}

export type PeriodSpec = string | { from: string; to: string }

export interface PeriodWindow {
  unit: "month" | "day"
  from: number
  to: number
}

export const COMPARE_MODES = ["previous-period", "previous-year", "budget", "forecast"] as const
export type CompareMode = (typeof COMPARE_MODES)[number]

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const
const DAY_MS = 86_400_000
const RELATIVE_UNITS = ["days", "months", "quarters", "years"] as const
type RelativeUnit = (typeof RELATIVE_UNITS)[number]
const isRelativeUnit = oneOf(RELATIVE_UNITS)
const MONTHS_PER_UNIT: Readonly<Record<Exclude<RelativeUnit, "days">, number>> = { months: 1, quarters: 3, years: 12 }
const TO_DATE_PERIODS = ["ytd", "qtd", "mtd"] as const
type ToDatePeriod = (typeof TO_DATE_PERIODS)[number]
const isToDatePeriod = oneOf(TO_DATE_PERIODS)

function point(year: number, month: number, day: number): TimePoint | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthFromName(name: string): number | null {
  const prefix = name.slice(0, 3).toLowerCase()
  const index = MONTH_NAMES.findIndex((candidate) => candidate === prefix)
  return index < 0 ? null : index + 1
}

export function parseTimeValue(raw: JsonValue): TimePoint | null {
  if (typeof raw === "number") {
    if (Number.isInteger(raw) && raw >= 1000 && raw <= 9999) return point(raw, 1, 1)
    if (raw > 1e11) return fromUtcDate(new Date(raw))
    return null
  }
  if (typeof raw !== "string") return null
  const value = raw.trim()
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(value)
  if (match) return point(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{4})[-/](\d{1,2})$/.exec(value)
  if (match) return point(Number(match[1]), Number(match[2]), 1)
  match = /^(\d{4})$/.exec(value)
  if (match) return point(Number(match[1]), 1, 1)
  match = /^(\d{4})[- ]?Q([1-4])$/i.exec(value)
  if (match) return point(Number(match[1]), (Number(match[2]) - 1) * 3 + 1, 1)
  match = /^Q([1-4])[- ]?(\d{4})$/i.exec(value)
  if (match) return point(Number(match[2]), (Number(match[1]) - 1) * 3 + 1, 1)
  match = /^([A-Za-z]{3,9})[- ](\d{4})$/.exec(value)
  if (match) {
    const month = monthFromName(match[1] ?? "")
    return month === null ? null : point(Number(match[2]), month, 1)
  }
  match = /^(\d{4})[- ]([A-Za-z]{3,9})$/.exec(value)
  if (match) {
    const month = monthFromName(match[2] ?? "")
    return month === null ? null : point(Number(match[1]), month, 1)
  }
  return null
}

function fromUtcDate(date: Date): TimePoint | null {
  if (Number.isNaN(date.getTime())) return null
  return point(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function monthIndex(p: TimePoint): number {
  return p.year * 12 + (p.month - 1)
}

export function dayIndex(p: TimePoint): number {
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS)
}

function fromMonthIndex(index: number, day = 1): TimePoint {
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  return { year, month, day: Math.min(day, daysInMonth(year, month)) }
}

function fromDayIndex(index: number): TimePoint {
  const date = new Date(index * DAY_MS)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

export function shiftPoint(p: TimePoint, months: number, days = 0): TimePoint {
  const shifted = fromMonthIndex(monthIndex(p) + months, p.day)
  return days === 0 ? shifted : fromDayIndex(dayIndex(shifted) + days)
}

export function bucketKey(p: TimePoint, grain: TimeGrain): string {
  const mm = String(p.month).padStart(2, "0")
  switch (grain) {
    case "day":
      return `${p.year}-${mm}-${String(p.day).padStart(2, "0")}`
    case "month":
      return `${p.year}-${mm}`
    case "quarter":
      return `${p.year}-Q${Math.floor((p.month - 1) / 3) + 1}`
    case "year":
      return String(p.year)
  }
}

export function bucketLabel(key: string, grain: TimeGrain): string {
  const parsed = parseTimeValue(key)
  if (!parsed) return key
  switch (grain) {
    case "day":
      return `${parsed.day} ${MONTH_LABELS[parsed.month - 1]} ${parsed.year}`
    case "month":
      return `${MONTH_LABELS[parsed.month - 1]} ${parsed.year}`
    case "quarter":
      return `Q${Math.floor((parsed.month - 1) / 3) + 1} ${parsed.year}`
    case "year":
      return String(parsed.year)
  }
}

export function windowContains(window: PeriodWindow, p: TimePoint): boolean {
  const index = window.unit === "month" ? monthIndex(p) : dayIndex(p)
  return index >= window.from && index <= window.to
}

function monthWindow(from: number, to: number): PeriodWindow {
  return { unit: "month", from, to }
}

function fiscalYearStartIndex(anchor: TimePoint, startMonth: number): number {
  const year = anchor.month >= startMonth ? anchor.year : anchor.year - 1
  return year * 12 + (startMonth - 1)
}

export type PeriodResolution = { ok: true; window: PeriodWindow | null } | { ok: false; message: string }

type PeriodAst =
  | { kind: "all" }
  | { kind: "toDate"; period: ToDatePeriod }
  | { kind: "relative"; count: number; unit: RelativeUnit }
  | { kind: "fiscal"; endYear: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "year"; year: number }
  | { kind: "month"; text: string }
  | { kind: "day"; text: string }
  | { kind: "unknown" }

const PERIOD_GRAMMAR_HINT = 'use all, last-12-months, ytd, qtd, mtd, fy2026, 2026, 2026-Q3, 2026-08, 2026-08-15, or {"from","to"}'

function parsePeriodSpec(spec: string): PeriodAst {
  const value = spec.trim().toLowerCase()
  if (value === "all") return { kind: "all" }
  if (isToDatePeriod(value)) return { kind: "toDate", period: value }
  const relative = /^last-(\d{1,3})-([a-z]+)$/.exec(value)
  const unit = relative?.[2]
  if (relative && isRelativeUnit(unit)) return { kind: "relative", count: Number(relative[1]), unit }
  const fiscal = /^fy(\d{4})$/.exec(value)
  if (fiscal) return { kind: "fiscal", endYear: Number(fiscal[1]) }
  const quarter = /^(\d{4})-q([1-4])$/.exec(value)
  if (quarter) return { kind: "quarter", year: Number(quarter[1]), quarter: Number(quarter[2]) }
  if (/^\d{4}$/.test(value)) return { kind: "year", year: Number(value) }
  if (/^\d{4}-\d{2}$/.test(value)) return { kind: "month", text: value }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: "day", text: value }
  return { kind: "unknown" }
}

export function resolvePeriod(spec: PeriodSpec | undefined, anchor: TimePoint | null, fiscalYearStartMonth = 1): PeriodResolution {
  if (spec === undefined) return { ok: true, window: null }
  if (typeof spec !== "string") return resolveRange(spec)
  const ast = parsePeriodSpec(spec)
  switch (ast.kind) {
    case "all":
      return { ok: true, window: null }
    case "toDate":
    case "relative":
      if (!anchor) return { ok: false, message: `period "${spec}" needs a time dimension with at least one dated row` }
      return { ok: true, window: resolveRelative(ast, anchor, fiscalYearStartMonth) }
    case "fiscal": {
      const start = (ast.endYear - (fiscalYearStartMonth === 1 ? 0 : 1)) * 12 + (fiscalYearStartMonth - 1)
      return { ok: true, window: monthWindow(start, start + 11) }
    }
    case "quarter": {
      const start = ast.year * 12 + (ast.quarter - 1) * 3
      return { ok: true, window: monthWindow(start, start + 2) }
    }
    case "year":
      return { ok: true, window: monthWindow(ast.year * 12, ast.year * 12 + 11) }
    case "month": {
      const parsed = parseTimeValue(ast.text)
      if (!parsed) return { ok: false, message: `"${spec}" is not a valid month` }
      return { ok: true, window: monthWindow(monthIndex(parsed), monthIndex(parsed)) }
    }
    case "day": {
      const parsed = parseTimeValue(ast.text)
      if (!parsed) return { ok: false, message: `"${spec}" is not a valid date` }
      return { ok: true, window: { unit: "day", from: dayIndex(parsed), to: dayIndex(parsed) } }
    }
    case "unknown":
      return { ok: false, message: `unknown period "${spec}"; ${PERIOD_GRAMMAR_HINT}` }
  }
}

function resolveRelative(
  ast: Extract<PeriodAst, { kind: "toDate" | "relative" }>,
  anchor: TimePoint,
  fiscalYearStartMonth: number,
): PeriodWindow {
  const anchorMonth = monthIndex(anchor)
  if (ast.kind === "toDate") {
    if (ast.period === "ytd") return monthWindow(fiscalYearStartIndex(anchor, fiscalYearStartMonth), anchorMonth)
    if (ast.period === "qtd") return monthWindow(anchorMonth - ((anchor.month - 1) % 3), anchorMonth)
    return monthWindow(anchorMonth, anchorMonth)
  }
  if (ast.unit === "days") return { unit: "day", from: dayIndex(anchor) - ast.count + 1, to: dayIndex(anchor) }
  const months = ast.count * MONTHS_PER_UNIT[ast.unit]
  return monthWindow(anchorMonth - months + 1, anchorMonth)
}

function resolveRange(range: { from: string; to: string }): PeriodResolution {
  const from = parseTimeValue(range.from)
  const to = parseTimeValue(range.to)
  if (!from || !to) return { ok: false, message: "a period range needs from and to dates such as 2026-01 and 2026-06" }
  const dayGranular = /\d{4}-\d{2}-\d{2}/.test(range.from) || /\d{4}-\d{2}-\d{2}/.test(range.to)
  const window: PeriodWindow = dayGranular
    ? { unit: "day", from: dayIndex(from), to: dayIndex(to) }
    : monthWindow(monthIndex(from), monthIndex(to))
  if (window.from > window.to) return { ok: false, message: "a period range must start before it ends" }
  return { ok: true, window }
}

export interface ComparisonShift {
  months: number
  days: number
}

export function comparisonShift(window: PeriodWindow, mode: "previous-period" | "previous-year"): ComparisonShift {
  if (mode === "previous-year") return { months: -12, days: 0 }
  const length = window.to - window.from + 1
  return window.unit === "month" ? { months: -length, days: 0 } : { months: 0, days: -length }
}

export function shiftWindow(window: PeriodWindow, shift: ComparisonShift): PeriodWindow {
  if (window.unit === "month") return monthWindow(window.from + shift.months, window.to + shift.months)
  const move = (index: number) => dayIndex(shiftPoint(fromDayIndex(index), shift.months, shift.days))
  return { unit: "day", from: move(window.from), to: move(window.to) }
}

const RELATIVE_UNIT_LABELS: Readonly<Record<RelativeUnit, string>> = { days: "day", months: "month", quarters: "quarter", years: "year" }
const TO_DATE_LABELS: Readonly<Record<ToDatePeriod, string>> = { ytd: "Year to date", qtd: "Quarter to date", mtd: "Month to date" }

export function describePeriodSpec(spec: PeriodSpec | undefined): string {
  if (spec === undefined) return "All time"
  if (typeof spec !== "string") return `${describePeriodSpec(spec.from)} – ${describePeriodSpec(spec.to)}`
  const ast = parsePeriodSpec(spec)
  switch (ast.kind) {
    case "all":
      return "All time"
    case "toDate":
      return TO_DATE_LABELS[ast.period]
    case "relative": {
      const unit = RELATIVE_UNIT_LABELS[ast.unit]
      return ast.count === 1 ? `Last ${unit}` : `Last ${ast.count} ${unit}s`
    }
    case "fiscal":
      return `FY${ast.endYear}`
    case "quarter":
      return bucketLabel(`${ast.year}-Q${ast.quarter}`, "quarter")
    case "day":
      return bucketLabel(ast.text, "day")
    case "month":
      return bucketLabel(ast.text, "month")
    case "year":
    case "unknown":
      return spec
  }
}

const COMPARE_LABELS: Readonly<Record<CompareMode | "none", string>> = {
  "previous-period": "Prior period",
  "previous-year": "Prior year",
  budget: "Budget",
  forecast: "Forecast",
  none: "No comparison",
}

export function describeCompareMode(mode: CompareMode | "none"): string {
  return COMPARE_LABELS[mode]
}

export function describeWindow(window: PeriodWindow | null): string {
  if (!window) return "All time"
  if (window.unit === "month") {
    const from = fromMonthIndex(window.from)
    const to = fromMonthIndex(window.to)
    const fromLabel = `${MONTH_LABELS[from.month - 1]} ${from.year}`
    const toLabel = `${MONTH_LABELS[to.month - 1]} ${to.year}`
    return window.from === window.to ? fromLabel : `${fromLabel} – ${toLabel}`
  }
  const from = fromDayIndex(window.from)
  const to = fromDayIndex(window.to)
  const fromLabel = bucketLabel(bucketKey(from, "day"), "day")
  return window.from === window.to ? fromLabel : `${fromLabel} – ${bucketLabel(bucketKey(to, "day"), "day")}`
}
