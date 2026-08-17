import { describe, expect, test } from "bun:test"
import { normalizePushSettings, PUSH_DEFAULTS } from "./push"

describe("normalizePushSettings", () => {
  test("returns defaults when value is undefined", () => {
    const warnings: string[] = []
    const result = normalizePushSettings(undefined, warnings)
    expect(result).toEqual(PUSH_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })

  test("accepts a valid mailto: contactSubject", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "mailto:admin@example.com" }, warnings)
    expect(result.contactSubject).toBe("mailto:admin@example.com")
    expect(warnings).toHaveLength(0)
  })

  test("accepts a valid https: contactSubject", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "https://example.com/push" }, warnings)
    expect(result.contactSubject).toBe("https://example.com/push")
    expect(warnings).toHaveLength(0)
  })

  test("trims whitespace from contactSubject", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "  mailto:admin@example.com  " }, warnings)
    expect(result.contactSubject).toBe("mailto:admin@example.com")
    expect(warnings).toHaveLength(0)
  })

  test("falls back to default when contactSubject is not a string", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: 123 }, warnings)
    expect(result.contactSubject).toBe(PUSH_DEFAULTS.contactSubject)
    expect(warnings).toContain("push.contactSubject must be a string")
  })

  test("falls back to default when contactSubject is not a valid VAPID subject", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "not-a-valid-subject" }, warnings)
    expect(result.contactSubject).toBe(PUSH_DEFAULTS.contactSubject)
    expect(warnings).toContain(
      "push.contactSubject must be a mailto: address or https: URL with a routable domain",
    )
  })

  test("falls back to default when contactSubject is mailto with localhost", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "mailto:user@localhost" }, warnings)
    expect(result.contactSubject).toBe(PUSH_DEFAULTS.contactSubject)
  })

  test("falls back to default when push value is not an object", () => {
    const warnings: string[] = []
    const result = normalizePushSettings("invalid", warnings)
    expect(result).toEqual(PUSH_DEFAULTS)
    expect(warnings).toContain("push must be an object")
  })

  test("falls back to default when contactSubject is an empty string", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({ contactSubject: "" }, warnings)
    expect(result.contactSubject).toBe(PUSH_DEFAULTS.contactSubject)
    expect(warnings).toHaveLength(0)
  })

  test("returns defaults when no contactSubject is set", () => {
    const warnings: string[] = []
    const result = normalizePushSettings({}, warnings)
    expect(result).toEqual(PUSH_DEFAULTS)
    expect(warnings).toHaveLength(0)
  })
})
