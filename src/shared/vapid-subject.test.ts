import { describe, expect, test } from "bun:test"
import {
  DEFAULT_VAPID_SUBJECT,
  isValidVapidSubject,
  resolveVapidSubject,
} from "./vapid-subject"

describe("isValidVapidSubject", () => {
  const valid: string[] = [
    "mailto:kanna@example.com",
    "mailto:bacuongtr@gmail.com",
    "mailto:a.b+c@sub.domain.co.uk",
    "https://github.com/cuongtranba/kanna",
    "https://kanna.lowbit.link",
    "  mailto:kanna@example.com  ",
  ]
  for (const s of valid) {
    test(`accepts ${JSON.stringify(s)}`, () => {
      expect(isValidVapidSubject(s)).toBe(true)
    })
  }

  const invalid: string[] = [
    "mailto:kanna@localhost",
    "mailto:kanna@nodot",
    "mailto:no-at-sign.com",
    "mailto:kanna@.com",
    "mailto:kanna@example.",
    "mailto:",
    "http://example.com",
    "https://localhost",
    "https://nodot",
    "kanna@example.com",
    "example.com",
    "",
  ]
  for (const s of invalid) {
    test(`rejects ${JSON.stringify(s)}`, () => {
      expect(isValidVapidSubject(s)).toBe(false)
    })
  }
})

describe("resolveVapidSubject", () => {
  test("prefers a valid configured subject", () => {
    expect(resolveVapidSubject("mailto:me@corp.com", "mailto:old@team.io")).toBe(
      "mailto:me@corp.com",
    )
  })

  test("falls back to legacy when configured is invalid/absent", () => {
    expect(resolveVapidSubject(undefined, "mailto:old@team.io")).toBe("mailto:old@team.io")
    expect(resolveVapidSubject("mailto:x@localhost", "mailto:old@team.io")).toBe(
      "mailto:old@team.io",
    )
  })

  test("falls back to the default when both are invalid/absent", () => {
    expect(resolveVapidSubject(undefined, undefined)).toBe(DEFAULT_VAPID_SUBJECT)
    expect(resolveVapidSubject("mailto:x@localhost", "mailto:y@localhost")).toBe(
      DEFAULT_VAPID_SUBJECT,
    )
    expect(resolveVapidSubject(null, null)).toBe(DEFAULT_VAPID_SUBJECT)
  })

  test("trims the returned subject", () => {
    expect(resolveVapidSubject("  mailto:me@corp.com  ", undefined)).toBe("mailto:me@corp.com")
  })
})
