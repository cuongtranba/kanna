/**
 * Schedule-text parser for the `/cron` command.
 *
 * Accepts three syntaxes, all normalized to `CronSchedule`:
 * - 5-field cron (minute hour day-of-month month day-of-week), e.g.
 *   star-slash-5 star star star star for "every 5 minutes"
 * - shortcuts: `@hourly` `@daily` `@weekly` `@monthly`
 * - interval sugar: `every 5m`, `every 2h`
 *
 * Every failure names the exact part that is wrong and, when the fix is
 * unambiguous, carries a corrected schedule fragment the command parser
 * assembles into a full ready-to-send `/cron` suggestion.
 */

import type { CronField, CronSchedule } from "./types"

export type ScheduleParse =
  | { ok: true; schedule: CronSchedule }
  | {
      ok: false
      part: "schedule" | "schedule_field"
      message: string
      /** Corrected schedule text (fragment, not a full /cron line). */
      correctedSchedule?: string
    }

const SHORTCUT_FIELDS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
}

export const CRON_SHORTCUTS: readonly string[] = Object.keys(SHORTCUT_FIELDS)

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

interface FieldSpec {
  name: string
  min: number
  max: number
  names?: Record<string, number>
  normalize?: (value: number) => number
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES },
  { name: "day-of-week", min: 0, max: 7, names: DOW_NAMES, normalize: (v) => (v === 7 ? 0 : v) },
]

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

export function parseSchedule(text: string): ScheduleParse {
  const trimmed = text.trim()
  if (trimmed === "") {
    return { ok: false, part: "schedule", message: "missing schedule — expected 5-field cron, @shortcut, or `every <N>m|h`" }
  }
  const tokens = trimmed.split(/\s+/)

  if (tokens[0]!.startsWith("@")) return parseShortcut(tokens)
  if (tokens[0]!.toLowerCase() === "every") return parseInterval(tokens)
  return parseCronFields(tokens)
}

function parseShortcut(tokens: string[]): ScheduleParse {
  const token = tokens[0]!.toLowerCase()
  const fields = SHORTCUT_FIELDS[token]
  if (fields === undefined) {
    const nearest = nearestShortcut(token)
    return {
      ok: false,
      part: "schedule",
      message: `unknown shortcut "${tokens[0]}" — valid shortcuts are ${CRON_SHORTCUTS.join(", ")}`,
      correctedSchedule: nearest ?? undefined,
    }
  }
  if (tokens.length > 1) {
    return {
      ok: false,
      part: "schedule",
      message: `${token} takes no extra tokens (got "${tokens.slice(1).join(" ")}")`,
      correctedSchedule: token,
    }
  }
  const parsed = parseCronFields(fields.split(" "))
  if (!parsed.ok) throw new Error(`builtin shortcut ${token} failed to parse: ${parsed.message}`)
  return parsed
}

function nearestShortcut(token: string): string | null {
  let best: string | null = null
  let bestDistance = 4
  for (const shortcut of CRON_SHORTCUTS) {
    const distance = levenshtein(token, shortcut, bestDistance)
    if (distance < bestDistance) {
      best = shortcut
      bestDistance = distance
    }
  }
  return best
}

function parseInterval(tokens: string[]): ScheduleParse {
  if (tokens.length === 1) {
    return { ok: false, part: "schedule", message: "missing interval after `every` — expected e.g. `every 5m` or `every 2h`" }
  }
  // `every 5 m` typed with a space: try re-joining before failing.
  const raw = tokens.length === 3 ? tokens[1]! + tokens[2]! : tokens[1]!
  if (tokens.length > 3 || (tokens.length === 3 && !isIntervalToken(raw))) {
    return {
      ok: false,
      part: "schedule",
      message: `expected exactly \`every <N>m|h\`, got "${tokens.join(" ")}"`,
    }
  }

  const strict = /^(\d+)(m|h)$/.exec(raw)
  if (strict) {
    const amount = Number.parseInt(strict[1]!, 10)
    if (amount < 1) {
      return { ok: false, part: "schedule", message: "interval must be at least 1", correctedSchedule: `every 1${strict[2]}` }
    }
    const unitMs = strict[2] === "h" ? HOUR_MS : MINUTE_MS
    const corrected = tokens.length === 3 ? `every ${raw}` : undefined
    if (corrected !== undefined) {
      return { ok: false, part: "schedule", message: `interval "${tokens.slice(1).join(" ")}" has a stray space`, correctedSchedule: corrected }
    }
    return { ok: true, schedule: { type: "interval", ms: amount * unitMs } }
  }

  const loose = /^(\d+)\s*(min|mins|minute|minutes|m|hr|hrs|hour|hours|h|s|sec|secs|second|seconds|d|day|days)$/i.exec(raw)
  if (loose) {
    const amount = loose[1]!
    const unit = loose[2]!.toLowerCase()
    if (unit.startsWith("s")) {
      return {
        ok: false,
        part: "schedule",
        message: "seconds are not supported — the minimum interval unit is minutes",
        correctedSchedule: "every 1m",
      }
    }
    if (unit.startsWith("d")) {
      return {
        ok: false,
        part: "schedule",
        message: `use @daily instead of "every ${amount}${unit}"`,
        correctedSchedule: "@daily",
      }
    }
    const short = unit.startsWith("h") ? "h" : "m"
    return {
      ok: false,
      part: "schedule",
      message: `interval unit "${unit}" is not valid — use \`m\` or \`h\``,
      correctedSchedule: `every ${amount}${short}`,
    }
  }

  return { ok: false, part: "schedule", message: `interval "${raw}" is not valid — expected e.g. \`every 5m\` or \`every 2h\`` }
}

function isIntervalToken(raw: string): boolean {
  return /^\d+\s*[a-z]+$/i.test(raw)
}

function parseCronFields(tokens: string[]): ScheduleParse {
  if (tokens.length !== 5) {
    if (tokens.length === 4) {
      return {
        ok: false,
        part: "schedule",
        message: `cron schedule has 4 fields, expected 5 (minute hour day-of-month month day-of-week)`,
        correctedSchedule: `${tokens.join(" ")} *`,
      }
    }
    if (tokens.length === 6) {
      const withoutSeconds = tokens.slice(1)
      const corrected = parseCronFields(withoutSeconds).ok ? withoutSeconds.join(" ") : undefined
      return {
        ok: false,
        part: "schedule",
        message: `cron schedule has 6 fields, expected 5 — Kanna cron has no seconds field`,
        correctedSchedule: corrected,
      }
    }
    const bareInterval = tokens.length === 1 && /^\d+(m|h)$/.test(tokens[0]!)
    return {
      ok: false,
      part: "schedule",
      message: `cron schedule has ${tokens.length} field${tokens.length === 1 ? "" : "s"}, expected 5 (minute hour day-of-month month day-of-week)`,
      correctedSchedule: bareInterval ? `every ${tokens[0]}` : undefined,
    }
  }

  const fields: CronField[] = []
  for (let i = 0; i < FIELD_SPECS.length; i++) {
    const parsed = parseField(FIELD_SPECS[i]!, tokens[i]!)
    if (!parsed.ok) return { ok: false, part: "schedule_field", message: parsed.message }
    fields.push(parsed.field)
  }

  return {
    ok: true,
    schedule: {
      type: "cron",
      minute: fields[0]!,
      hour: fields[1]!,
      dom: fields[2]!,
      month: fields[3]!,
      dow: fields[4]!,
      domRestricted: !tokens[2]!.startsWith("*"),
      dowRestricted: !tokens[4]!.startsWith("*"),
    },
  }
}

type FieldParse = { ok: true; field: CronField } | { ok: false; message: string }

function parseField(spec: FieldSpec, raw: string): FieldParse {
  if (raw === "*") return { ok: true, field: { kind: "any" } }

  const values = new Set<number>()
  for (const part of raw.split(",")) {
    if (part === "") {
      return { ok: false, message: `${spec.name} field "${raw}" has an empty list entry` }
    }
    const match = /^(\*|[A-Za-z]+|\d+)(?:-([A-Za-z]+|\d+))?(?:\/(\d+))?$/.exec(part)
    if (!match) {
      return { ok: false, message: `${spec.name} field "${part}" is not valid — expected \`*\`, \`N\`, \`N-M\`, \`*/S\`, or \`N-M/S\`` }
    }
    const [, startRaw, endRaw, stepRaw] = match

    let start: number
    let end: number
    if (startRaw === "*") {
      if (endRaw !== undefined) {
        return { ok: false, message: `${spec.name} field "${part}" is not valid — \`*\` cannot be a range start` }
      }
      start = spec.min
      end = spec.max
    } else {
      const startValue = resolveValue(spec, startRaw!)
      if (startValue === null) {
        return { ok: false, message: badValueMessage(spec, startRaw!) }
      }
      start = startValue
      if (endRaw !== undefined) {
        const endValue = resolveValue(spec, endRaw)
        if (endValue === null) {
          return { ok: false, message: badValueMessage(spec, endRaw) }
        }
        end = endValue
      } else {
        end = start
      }
    }

    if (start < spec.min || start > spec.max || end < spec.min || end > spec.max) {
      return { ok: false, message: `${spec.name} field "${part}" is out of range ${spec.min}-${spec.max}` }
    }
    if (end < start) {
      return { ok: false, message: `${spec.name} field "${part}" has a range end below its start` }
    }

    let step = 1
    if (stepRaw !== undefined) {
      step = Number.parseInt(stepRaw, 10)
      if (step < 1) {
        return { ok: false, message: `${spec.name} field "${part}" has a step of 0 — steps start at 1` }
      }
      if (startRaw !== "*" && endRaw === undefined) {
        return { ok: false, message: `${spec.name} field "${part}" applies a step to a single value — use \`*/S\` or \`N-M/S\`` }
      }
    }

    for (let value = start; value <= end; value += step) {
      values.add(spec.normalize ? spec.normalize(value) : value)
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  return { ok: true, field: { kind: "values", values: sorted } }
}

function resolveValue(spec: FieldSpec, raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)
  const named = spec.names?.[raw.toLowerCase()]
  return named ?? null
}

function badValueMessage(spec: FieldSpec, raw: string): string {
  if (/^\d+$/.test(raw)) return `${spec.name} field "${raw}" is out of range ${spec.min}-${spec.max}`
  if (spec.names) {
    return `${spec.name} field "${raw}" is not a valid ${spec.name} name (${Object.keys(spec.names).join(", ")})`
  }
  return `${spec.name} field "${raw}" is not a number`
}

/** Bounded Levenshtein distance — bails out once `limit` is exceeded. */
export function levenshtein(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]!
}
