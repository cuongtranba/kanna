import { isPlainObject, clampToRange } from "./plain-object"

export interface AuthSettings {
  sessionMaxAgeDays: number
}

export const AUTH_DEFAULTS: AuthSettings = {
  sessionMaxAgeDays: 30,
}

export const AUTH_SESSION_MAX_AGE_DAYS_MIN = 1
export const AUTH_SESSION_MAX_AGE_DAYS_MAX = 365

export function normalizeAuthSettings<T>(value: T, warnings: string[]): AuthSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("auth must be an object")
  }

  const rawMaxAge = source?.sessionMaxAgeDays
  if (rawMaxAge === undefined) return { ...AUTH_DEFAULTS }

  if (typeof rawMaxAge !== "number" || !Number.isFinite(rawMaxAge)) {
    warnings.push("auth.sessionMaxAgeDays must be a number")
    return { ...AUTH_DEFAULTS }
  }

  if (rawMaxAge < AUTH_SESSION_MAX_AGE_DAYS_MIN || rawMaxAge > AUTH_SESSION_MAX_AGE_DAYS_MAX) {
    warnings.push(
      `auth.sessionMaxAgeDays must be between ${AUTH_SESSION_MAX_AGE_DAYS_MIN} and ${AUTH_SESSION_MAX_AGE_DAYS_MAX}`,
    )
    return {
      sessionMaxAgeDays: clampToRange(
        rawMaxAge,
        AUTH_SESSION_MAX_AGE_DAYS_MIN,
        AUTH_SESSION_MAX_AGE_DAYS_MAX,
        AUTH_DEFAULTS.sessionMaxAgeDays,
      ),
    }
  }

  return { sessionMaxAgeDays: Math.round(rawMaxAge) }
}
