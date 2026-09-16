import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
import { log } from "../../shared/log"

export interface LimitDetection {
  chatId: string
  resetAt: number
  tz: string
  raw: Error | JsonValue
}

export interface LimitDetector {
  detect(chatId: string, error: Error, nowMs?: number): LimitDetection | null
  detectFromResultText?(chatId: string, text: string, nowMs?: number): LimitDetection | null
  detectFromSdkRateLimitInfo?(chatId: string, info: JsonValue, nowMs?: number): LimitDetection | null
}

const MAX_LIMIT_WINDOW_MS = 8 * 24 * 60 * 60 * 1000

const OVERAGE_RATE_LIMIT_TYPE = "overage"

const EPOCH_SECONDS_CEILING = 1e12

const EPOCH_DIGITS = /^\d{9,13}$/

function epochToMillis(value: number): number {
  return value < EPOCH_SECONDS_CEILING ? Math.round(value * 1000) : value
}

function isServableLimitWindow(resetAt: number, nowMs: number): boolean {
  return resetAt - nowMs <= MAX_LIMIT_WINDOW_MS
}

function acceptDetection(detection: LimitDetection, nowMs: number, source: string): LimitDetection | null {
  if (isServableLimitWindow(detection.resetAt, nowMs)) return detection
  log.warn("[limit-detector] ignoring implausibly distant rate-limit reset", {
    chatId: detection.chatId,
    source,
    resetAt: new Date(detection.resetAt).toISOString(),
    maxWindowMs: MAX_LIMIT_WINDOW_MS,
  })
  return null
}

interface RateLimitErrorLike {
  readonly message?: string
  readonly headers?: JsonValue
  readonly status?: JsonValue
  readonly code?: JsonValue
  readonly data?: JsonValue
}

function extractHeaders(error: Error): JsonObject {
  const like: RateLimitErrorLike = error
  const headers = like.headers
  return headers !== undefined && isJsonObject(headers) ? headers : {}
}

function parseBody(error: Error): JsonObject | null {
  if (!error.message) return null
  const parsed = safeJsonParse(error.message)
  return parsed !== null && isJsonObject(parsed) ? parsed : null
}

function parseResetMillis(value: JsonValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? epochToMillis(value) : null
  }
  if (typeof value !== "string" || !value) return null
  if (EPOCH_DIGITS.test(value)) {
    const epoch = Number(value)
    return Number.isFinite(epoch) && epoch > 0 ? epochToMillis(epoch) : null
  }
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
  detect(chatId: string, error: Error, nowMs: number = Date.now()): LimitDetection | null {
    const like: RateLimitErrorLike = error
    const body = parseBody(error)
    const inner = body && isJsonObject(body.error) ? body.error : null
    const isRateLimit = inner?.type === "rate_limit_error"
      || (like.status === 429 && inner?.type === "rate_limit_error")

    if (isRateLimit) {
      const headers = extractHeaders(error)
      const resetAt = parseResetMillis(headers["anthropic-ratelimit-unified-reset"])
        ?? parseResetMillis(inner?.resets_at)
        ?? parseResetMillis(inner?.reset_at)
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
        const accepted = acceptDetection({ chatId, resetAt, tz, raw: error }, nowMs, "error_headers")
        if (accepted !== null) return accepted
      }
    }

    return this.detectFromResultText(chatId, error.message, nowMs)
  }

  detectFromResultText(chatId: string, text: string, nowMs: number = Date.now()): LimitDetection | null {
    const parsed = parseResetFromText(text, nowMs)
    if (parsed) {
      return acceptDetection({ chatId, resetAt: parsed.resetAt, tz: parsed.tz, raw: text }, nowMs, "result_text")
    }
    const pipe = parseClaudeUsageLimitPipe(text)
    if (pipe !== null) {
      return acceptDetection({ chatId, resetAt: pipe, tz: "system", raw: text }, nowMs, "usage_limit_pipe")
    }
    return null
  }

  detectFromSdkRateLimitInfo(chatId: string, info: JsonValue, nowMs: number = Date.now()): LimitDetection | null {
    if (!isJsonObject(info)) return null
    if (info.status !== "rejected") return null
    const raw = info.resetsAt
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null
    if (isOverageClaim(info, raw)) {
      log.warn("[limit-detector] ignoring overage-only rate-limit claim", {
        chatId,
        rateLimitType: typeof info.rateLimitType === "string" ? info.rateLimitType : null,
        overageDisabledReason:
          typeof info.overageDisabledReason === "string" ? info.overageDisabledReason : null,
        resetAt: new Date(epochToMillis(raw)).toISOString(),
      })
      return null
    }
    return acceptDetection(
      { chatId, resetAt: epochToMillis(raw), tz: "system", raw: info },
      nowMs,
      "sdk_rate_limit_event",
    )
  }
}

function isOverageClaim(info: JsonObject, resetsAt: number): boolean {
  if (info.rateLimitType === OVERAGE_RATE_LIMIT_TYPE) return true
  return info.overageStatus === "rejected" && info.overageResetsAt === resetsAt
}

export function parseClaudeUsageLimitPipe(text: string): number | null {
  if (typeof text !== "string") return null
  const match = text.match(/usage limit reached\|(\d{9,13})/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  return epochToMillis(value)
}

export class CodexLimitDetector implements LimitDetector {
  detect(chatId: string, error: Error, nowMs: number = Date.now()): LimitDetection | null {
    const like: RateLimitErrorLike = error
    const rpcCode = like.code
    const rpcData = like.data !== undefined && isJsonObject(like.data) ? like.data : null
    const isRateLimit = rpcData?.code === "rate_limit" || rpcCode === -32001
    if (!isRateLimit) return null

    let resetAt: number | null
    if (typeof rpcData?.resets_at_ms === "number" && Number.isFinite(rpcData.resets_at_ms)) {
      resetAt = rpcData.resets_at_ms
    } else {
      resetAt = parseResetMillis(rpcData?.resets_at)
    }
    if (resetAt === null) return null

    const tz = typeof rpcData?.timezone === "string" ? rpcData.timezone : "system"
    return acceptDetection({ chatId, resetAt, tz, raw: error }, nowMs, "codex_rpc")
  }
}
