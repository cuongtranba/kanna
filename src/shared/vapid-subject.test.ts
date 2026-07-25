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
    "  mailto:kanna@example.com  ", // trimmed
  ]
  for (const s of valid) {
    test(`accepts ${JSON.stringify(s)}`, () => {
      expect(isValidVapidSubject(s)).toBe(true)
    })
  }

  const invalid: string[] = [
    "mailto:kanna@localhost", // the real-world poison → Apple 403 BadJwtToken
    "mailto:kanna@nodot", // domain without a dot
    "mailto:no-at-sign.com", // missing @
    "mailto:kanna@.com", // leading-dot domain
    "mailto:kanna@example.", // trailing-dot domain
    "mailto:", // empty
    "http://example.com", // not https
    "https://localhost", // non-routable host
    "https://nodot", // host without a dot
    "kanna@example.com", // no scheme
    "example.com", // bare
    "", // empty
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
