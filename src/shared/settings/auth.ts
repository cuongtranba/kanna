import { normalizeBounded, type NumericBound } from "../numeric"
import { readSettingsSection } from "./read-fields"

export interface AuthSettings {
  sessionMaxAgeDays: number
}

export const AUTH_DEFAULTS: AuthSettings = {
  sessionMaxAgeDays: 30,
}

export const AUTH_SESSION_MAX_AGE_DAYS_MIN = 1
export const AUTH_SESSION_MAX_AGE_DAYS_MAX = 365

export const AUTH_SESSION_MAX_AGE_DAYS_BOUND = {
  path: "auth.sessionMaxAgeDays",
  min: AUTH_SESSION_MAX_AGE_DAYS_MIN,
  max: AUTH_SESSION_MAX_AGE_DAYS_MAX,
  integer: false,
} as const satisfies NumericBound

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
