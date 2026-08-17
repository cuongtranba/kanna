import { describe, expect, test } from "bun:test"
import {
  UPLOAD_DEFAULTS,
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  UPLOAD_MAX_FILE_SIZE_MB_MIN,
  normalizeUploadSettings,
} from "./uploads"

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
