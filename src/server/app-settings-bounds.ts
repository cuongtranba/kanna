import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  CLAUDE_IDLE_TIMEOUT_MS_MAX,
  CLAUDE_IDLE_TIMEOUT_MS_MIN,
  CLAUDE_MAX_CONCURRENT_MAX,
  CLAUDE_MAX_CONCURRENT_MIN,
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
  type AuthSettings,
  type UploadSettings,
} from "../shared/types"
import { clampRounded } from "../shared/numeric"
import { readSettingsSection } from "../shared/settings/read-fields"

export interface NumericBound {
  readonly path: string
  readonly min: number
  readonly max: number
  readonly integer: boolean
}

export type BoundPolicy = "clamp" | "fallback"

export const SHARE_DEFAULT_TTL_HOURS_BOUND = {
  path: "shareDefaultTtlHours",
  min: 1,
  max: Number.POSITIVE_INFINITY,
  integer: true,
} as const satisfies NumericBound

export const SUBAGENT_RUN_TIMEOUT_MS_BOUND = {
  path: "subagentRuntime.runTimeoutMs",
  min: 30_000,
  max: 86_400_000,
  integer: true,
} as const satisfies NumericBound

export const AUTH_SESSION_MAX_AGE_DAYS_BOUND = {
  path: "auth.sessionMaxAgeDays",
  min: AUTH_SESSION_MAX_AGE_DAYS_MIN,
  max: AUTH_SESSION_MAX_AGE_DAYS_MAX,
  integer: false,
} as const satisfies NumericBound

export const UPLOAD_MAX_FILE_SIZE_MB_BOUND = {
  path: "uploads.maxFileSizeMb",
  min: UPLOAD_MAX_FILE_SIZE_MB_MIN,
  max: UPLOAD_MAX_FILE_SIZE_MB_MAX,
  integer: false,
} as const satisfies NumericBound

export const CLAUDE_IDLE_TIMEOUT_MS_BOUND = {
  path: "claudeDriver.lifecycle.idleTimeoutMs",
  min: CLAUDE_IDLE_TIMEOUT_MS_MIN,
  max: CLAUDE_IDLE_TIMEOUT_MS_MAX,
  integer: false,
} as const satisfies NumericBound

export const CLAUDE_MAX_CONCURRENT_BOUND = {
  path: "claudeDriver.lifecycle.maxConcurrent",
  min: CLAUDE_MAX_CONCURRENT_MIN,
  max: CLAUDE_MAX_CONCURRENT_MAX,
  integer: false,
} as const satisfies NumericBound

function requirement(bound: NumericBound): string {
  if (!Number.isFinite(bound.max)) return `${bound.path} must be an integer >= ${bound.min}`
  if (bound.integer) return `${bound.path} must be an integer between ${bound.min} and ${bound.max}`
  return `${bound.path} must be between ${bound.min} and ${bound.max}`
}

function isFiniteNumber<T>(value: T): value is T & number {
  return typeof value === "number" && Number.isFinite(value)
}

function violatesRange(bound: NumericBound, value: number): boolean {
  return value < bound.min || value > bound.max || (bound.integer && !Number.isInteger(value))
}

export function boundViolation<T>(bound: NumericBound, value: T): string | null {
  if (!isFiniteNumber(value)) {
    return bound.integer ? requirement(bound) : `${bound.path} must be a number`
  }
  return violatesRange(bound, value) ? requirement(bound) : null
}

export function assertWithinBound<T>(bound: NumericBound, value: T): void {
  const violation = boundViolation(bound, value)
  if (violation) throw new Error(violation)
}

export function normalizeBounded<T>(
  bound: NumericBound,
  raw: T,
  fallback: number,
  policy: BoundPolicy,
  warnings: string[],
): number {
  if (raw === undefined) return fallback
  const violation = boundViolation(bound, raw)
  if (!violation) return isFiniteNumber(raw) ? Math.round(raw) : fallback
  warnings.push(violation)
  if (policy === "clamp" && isFiniteNumber(raw)) {
    return clampRounded(raw, bound, fallback)
  }
  return fallback
}

export function normalizeAuthSettings<T>(value: T, warnings: string[]): AuthSettings {
  const source = readSettingsSection(value, "auth", warnings).source
  return {
    sessionMaxAgeDays: normalizeBounded(
      AUTH_SESSION_MAX_AGE_DAYS_BOUND,
      source?.sessionMaxAgeDays,
      AUTH_DEFAULTS.sessionMaxAgeDays,
      "clamp",
      warnings,
    ),
  }
}

export function normalizeUploadSettings<T>(value: T, warnings: string[]): UploadSettings {
  const source = readSettingsSection(value, "uploads", warnings).source
  return {
    maxFileSizeMb: normalizeBounded(
      UPLOAD_MAX_FILE_SIZE_MB_BOUND,
      source?.maxFileSizeMb,
      UPLOAD_DEFAULTS.maxFileSizeMb,
      "clamp",
      warnings,
    ),
  }
}
