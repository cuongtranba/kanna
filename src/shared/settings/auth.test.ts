import { describe, expect, test } from "bun:test"
import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  normalizeAuthSettings,
} from "./auth"

describe("normalizeAuthSettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings(undefined, warnings)
    expect(result).toEqual(AUTH_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("returns defaults when value is not an object", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings("invalid", warnings)
    expect(result).toEqual(AUTH_DEFAULTS)
    expect(warnings).toContain("auth must be an object")
  })

  test("accepts a valid sessionMaxAgeDays", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: 60 }, warnings)
    expect(result.sessionMaxAgeDays).toBe(60)
    expect(warnings).toHaveLength(0)
  })

  test("rounds fractional sessionMaxAgeDays", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: 30.7 }, warnings)
    expect(result.sessionMaxAgeDays).toBe(31)
    expect(warnings).toHaveLength(0)
  })

  test("accepts boundary minimum value", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: AUTH_SESSION_MAX_AGE_DAYS_MIN }, warnings)
    expect(result.sessionMaxAgeDays).toBe(AUTH_SESSION_MAX_AGE_DAYS_MIN)
    expect(warnings).toHaveLength(0)
  })

  test("accepts boundary maximum value", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: AUTH_SESSION_MAX_AGE_DAYS_MAX }, warnings)
    expect(result.sessionMaxAgeDays).toBe(AUTH_SESSION_MAX_AGE_DAYS_MAX)
    expect(warnings).toHaveLength(0)
  })

  test("warns and clamps when sessionMaxAgeDays is below minimum", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: 0 }, warnings)
    expect(result.sessionMaxAgeDays).toBe(AUTH_SESSION_MAX_AGE_DAYS_MIN)
    expect(warnings).toContain(
      `auth.sessionMaxAgeDays must be between ${AUTH_SESSION_MAX_AGE_DAYS_MIN} and ${AUTH_SESSION_MAX_AGE_DAYS_MAX}`,
    )
  })

  test("warns and clamps when sessionMaxAgeDays is above maximum", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: 9999 }, warnings)
    expect(result.sessionMaxAgeDays).toBe(AUTH_SESSION_MAX_AGE_DAYS_MAX)
    expect(warnings).toContain(
      `auth.sessionMaxAgeDays must be between ${AUTH_SESSION_MAX_AGE_DAYS_MIN} and ${AUTH_SESSION_MAX_AGE_DAYS_MAX}`,
    )
  })

  test("warns and returns default when sessionMaxAgeDays is not a number", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: "thirty" }, warnings)
    expect(result).toEqual(AUTH_DEFAULTS)
    expect(warnings).toContain("auth.sessionMaxAgeDays must be a number")
  })

  test("warns and returns default when sessionMaxAgeDays is NaN", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({ sessionMaxAgeDays: NaN }, warnings)
    expect(result).toEqual(AUTH_DEFAULTS)
    expect(warnings).toContain("auth.sessionMaxAgeDays must be a number")
  })

  test("returns defaults when sessionMaxAgeDays is undefined", () => {
    const warnings: string[] = []
    const result = normalizeAuthSettings({}, warnings)
    expect(result).toEqual(AUTH_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })
})
