import { type AnyValue, isRecord } from "../../shared/errors"

export interface LimitDetection {
  chatId: string
  resetAt: number
  tz: string
  raw: AnyValue
}

export interface LimitDetector {
  detect(chatId: string, error: AnyValue): LimitDetection | null
  detectFromResultText?(chatId: string, text: string, nowMs?: number): LimitDetection | null
  detectFromSdkRateLimitInfo?(chatId: string, info: AnyValue): LimitDetection | null
}

function extractHeaders(error: AnyValue): Record<string, AnyValue> {
  if (isRecord(error) && "headers" in error && isRecord(error.headers)) {
    return error.headers
  }
  return {}
}

function parseBody(error: AnyValue): Record<string, AnyValue> | null {
  if (!isRecord(error)) return null
  const message = error.message
  if (typeof message !== "string" || !message) return null
  try {
    const parsed: AnyValue = JSON.parse(message)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseIsoMillis(value: AnyValue): number | null {
  if (typeof value !== "string" || !value) return null
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

function zonedWallClockToUtcMs(
  year: number, month: number, day: number, hour: number, minute: number, tz: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(utcGuess))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  )
  const asLocal = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute),
  )
  return utcGuess - (asLocal - utcGuess)
}

export function parseResetFromText(text: string, nowMs: number = Date.now()): { resetAt: number; tz: string } | null {
  if (typeof text !== "string") return null
  const match = text.match(/resets\s+(\d{1,2})(?::(\d{2}))?(am|pm)\s*\(([^)]+)\)/i)
  if (!match) return null
  const hour12 = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = match[3].toLowerCase()
  const tz = match[4].trim()
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return null
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null
  let hour24: number
  if (meridiem === "pm") {
    hour24 = hour12 === 12 ? 12 : hour12 + 12
  } else {
    hour24 = hour12 === 12 ? 0 : hour12
  }
  let tzYear: number, tzMonth: number, tzDay: number
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    })
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(nowMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    )
    tzYear = Number(parts.year)
    tzMonth = Number(parts.month)
    tzDay = Number(parts.day)
  } catch {
    return null
  }
  let resetAt = zonedWallClockToUtcMs(tzYear, tzMonth, tzDay, hour24, minute, tz)
  if (resetAt <= nowMs) {
    const next = new Date(Date.UTC(tzYear, tzMonth - 1, tzDay) + 24 * 3600_000)
    resetAt = zonedWallClockToUtcMs(
      next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour24, minute, tz,
    )
  }
  return { resetAt, tz }
}

export class ClaudeLimitDetector implements LimitDetector {
  detect(chatId: string, error: AnyValue): LimitDetection | null {
    const body = parseBody(error)
    const inner = body && isRecord(body.error) ? body.error : null
    const isRateLimit = inner?.type === "rate_limit_error"
      || (isRecord(error) && error.status === 429 && inner?.type === "rate_limit_error")

    if (isRateLimit) {
      const headers = extractHeaders(error)
      const resetAt = parseIsoMillis(headers["anthropic-ratelimit-unified-reset"])
        ?? parseIsoMillis(inner?.resets_at)
        ?? parseIsoMillis(inner?.reset_at)
      if (resetAt !== null) {
        const timezone = inner?.timezone
        let tz: string
        if (typeof headers["x-anthropic-timezone"] === "string") {
          tz = headers["x-anthropic-timezone"]
        } else if (typeof timezone === "string") {
          tz = timezone
        } else {
          tz = "system"
        }
        return { chatId, resetAt, tz, raw: error }
      }
    }

    // Fallback: the Claude Code SDK rethrows CLI result errors as
    // `Error("Claude Code returned an error result: <text>")`. Parse the
    // text directly for "You've hit your limit · resets ..." / "usage limit
    // reached|<unix>" forms.
    const message = isRecord(error) ? error.message : null
    if (typeof message === "string") {
      return this.detectFromResultText(chatId, message)
    }
    return null
  }

  detectFromResultText(chatId: string, text: string, nowMs: number = Date.now()): LimitDetection | null {
    const parsed = parseResetFromText(text, nowMs)
    if (parsed) return { chatId, resetAt: parsed.resetAt, tz: parsed.tz, raw: text }
    const pipe = parseClaudeUsageLimitPipe(text)
    if (pipe !== null) return { chatId, resetAt: pipe, tz: "system", raw: text }
    return null
  }

  detectFromSdkRateLimitInfo(chatId: string, info: AnyValue): LimitDetection | null {
    if (!isRecord(info)) return null
    if (info.status !== "rejected") return null
    const raw = info.resetsAt
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null
    // SDK emits `resetsAt` as epoch seconds for claude.ai subscription limits;
    // coerce to ms defensively (anything below year 5138 in ms is below 1e14).
    const resetAt = raw < 1e12 ? Math.round(raw * 1000) : raw
    return { chatId, resetAt, tz: "system", raw: info }
  }
}

export function parseClaudeUsageLimitPipe(text: string): number | null {
  // Claude CLI sometimes returns "Claude AI usage limit reached|<unix-seconds>".
  if (typeof text !== "string") return null
  const match = text.match(/usage limit reached\|(\d{9,13})/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return value < 1e12 ? value * 1000 : value
}

export class CodexLimitDetector implements LimitDetector {
  detect(chatId: string, error: AnyValue): LimitDetection | null {
    if (!isRecord(error)) return null
    const rpcCode = error.code
    const rpcData = isRecord(error.data) ? error.data : null
    const isRateLimit = rpcData?.code === "rate_limit" || rpcCode === -32001
    if (!isRateLimit) return null

    let resetAt: number | null
    if (typeof rpcData?.resets_at_ms === "number" && Number.isFinite(rpcData.resets_at_ms)) {
      resetAt = rpcData.resets_at_ms
    } else {
      resetAt = parseIsoMillis(rpcData?.resets_at)
    }
    if (resetAt === null) return null

    const tz = typeof rpcData?.timezone === "string" ? rpcData.timezone : "system"
    return { chatId, resetAt, tz, raw: error }
  }
}
