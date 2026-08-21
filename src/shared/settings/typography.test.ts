import { describe, expect, test } from "bun:test"
import { TYPOGRAPHY_DEFAULTS, normalizeTypographySettings } from "./typography"

describe("normalizeTypographySettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings(undefined, warnings)
    expect(result).toEqual(TYPOGRAPHY_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("returns defaults when value is not an object", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings("x", warnings)
    expect(result).toEqual(TYPOGRAPHY_DEFAULTS)
    expect(warnings).toContain("typography must be an object")
  })

  test("returns defaults when value is a number", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings(42, warnings)
    expect(result).toEqual(TYPOGRAPHY_DEFAULTS)
    expect(warnings).toContain("typography must be an object")
  })

  test("accepts a valid scale step", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings({ scale: "lg" }, warnings)
    expect(result).toEqual({ scale: "lg" })
    expect(warnings).toHaveLength(0)
  })

  test("warns and returns default when scale is the wrong type", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings({ scale: 5 }, warnings)
    expect(result).toEqual(TYPOGRAPHY_DEFAULTS)
    expect(warnings).toContain("typography.scale must be one of: sm, md, lg, xl, xxl")
  })

  test("warns and returns default when scale is an unknown step string", () => {
    const warnings: string[] = []
    const result = normalizeTypographySettings({ scale: "nope" }, warnings)
    expect(result).toEqual({ scale: "md" })
    expect(warnings).toHaveLength(1)
    expect(warnings).toContain("typography.scale must be one of: sm, md, lg, xl, xxl")
  })
})
