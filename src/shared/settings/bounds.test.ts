import { describe, expect, test } from "vite-plus/test"
import {
  AUTH_DEFAULTS,
  AUTH_SESSION_MAX_AGE_DAYS_MAX,
  AUTH_SESSION_MAX_AGE_DAYS_MIN,
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
} from "../types"
import {
  boundViolation,
  globalPromptAppendViolation,
  normalizeAuthSettings,
  normalizeBounded,
  normalizeUploadSettings,
  OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND,
} from "./bounds"

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

describe("normalizeUploadSettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings(undefined, warnings)
    expect(result).toEqual(UPLOAD_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("returns defaults when value is not an object", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings("invalid", warnings)
    expect(result).toEqual(UPLOAD_DEFAULTS)
    expect(warnings).toContain("uploads must be an object")
  })

  test("defaults to 2 GB and accepts up to 50 GB per file", () => {
    const warnings: string[] = []
    expect(UPLOAD_DEFAULTS.maxFileSizeMb).toBe(2048)
    expect(normalizeUploadSettings({ maxFileSizeMb: 51200 }, warnings).maxFileSizeMb).toBe(51200)
    expect(normalizeUploadSettings({ maxFileSizeMb: 51201 }, warnings).maxFileSizeMb).toBe(51200)
    expect(warnings).toHaveLength(1)
  })

  test("accepts a valid maxFileSizeMb", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: 200 }, warnings)
    expect(result.maxFileSizeMb).toBe(200)
    expect(warnings).toHaveLength(0)
  })

  test("rounds fractional maxFileSizeMb", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: 150.6 }, warnings)
    expect(result.maxFileSizeMb).toBe(151)
    expect(warnings).toHaveLength(0)
  })

  test("accepts boundary minimum value", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: UPLOAD_MAX_FILE_SIZE_MB_MIN }, warnings)
    expect(result.maxFileSizeMb).toBe(UPLOAD_MAX_FILE_SIZE_MB_MIN)
    expect(warnings).toHaveLength(0)
  })

  test("accepts boundary maximum value", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: UPLOAD_MAX_FILE_SIZE_MB_MAX }, warnings)
    expect(result.maxFileSizeMb).toBe(UPLOAD_MAX_FILE_SIZE_MB_MAX)
    expect(warnings).toHaveLength(0)
  })

  test("warns and clamps when maxFileSizeMb is below minimum", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: 0 }, warnings)
    expect(result.maxFileSizeMb).toBe(UPLOAD_MAX_FILE_SIZE_MB_MIN)
    expect(warnings).toContain(
      `uploads.maxFileSizeMb must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX}`,
    )
  })

  test("warns and clamps when maxFileSizeMb is above maximum", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: 99999 }, warnings)
    expect(result.maxFileSizeMb).toBe(UPLOAD_MAX_FILE_SIZE_MB_MAX)
    expect(warnings).toContain(
      `uploads.maxFileSizeMb must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX}`,
    )
  })

  test("warns and returns default when maxFileSizeMb is not a number", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: "large" }, warnings)
    expect(result).toEqual(UPLOAD_DEFAULTS)
    expect(warnings).toContain("uploads.maxFileSizeMb must be a number")
  })

  test("warns and returns default when maxFileSizeMb is Infinity", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({ maxFileSizeMb: Infinity }, warnings)
    expect(result).toEqual(UPLOAD_DEFAULTS)
    expect(warnings).toContain("uploads.maxFileSizeMb must be a number")
  })

  test("returns defaults when maxFileSizeMb is undefined", () => {
    const warnings: string[] = []
    const result = normalizeUploadSettings({}, warnings)
    expect(result).toEqual(UPLOAD_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })
})

describe("token concurrency bound", () => {
  test("has no ceiling and says so in its message", () => {
    expect(boundViolation(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 12)).toBeNull()
    expect(boundViolation(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 0)).toBe("claudeAuth.concurrencyDefault must be at least 1")
  })

  test("clamps a too-small value to the floor and warns", () => {
    const warnings: string[] = []
    expect(normalizeBounded(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, 0, 1, "clamp", warnings)).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  test("a non-number keeps the fallback and warns that it must be a number", () => {
    const warnings: string[] = []
    expect(normalizeBounded(OAUTH_TOKEN_CONCURRENCY_DEFAULT_BOUND, "3", 1, "clamp", warnings)).toBe(1)
    expect(warnings).toEqual(["claudeAuth.concurrencyDefault must be a number"])
  })
})

describe("globalPromptAppendViolation", () => {
  test("accepts text up to the limit and names the limit when exceeded", () => {
    expect(globalPromptAppendViolation("ok")).toBeNull()
    expect(globalPromptAppendViolation("x".repeat(8_001))).toBe("globalPromptAppend must be 8000 chars or fewer")
    expect(globalPromptAppendViolation(5)).toBe("globalPromptAppend must be a string")
  })
})
