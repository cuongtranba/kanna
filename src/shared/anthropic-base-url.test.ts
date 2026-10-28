import { describe, expect, test } from "vite-plus/test"
import { normalizeAnthropicBaseUrl, parseBaseUrlDraft } from "./anthropic-base-url"

describe("normalizeAnthropicBaseUrl", () => {
  test("trims and strips trailing slashes", () => {
    expect(normalizeAnthropicBaseUrl("  https://api.example.com//  ", 100)).toBe("https://api.example.com")
  })

  test("rejects anything that is not http or https", () => {
    expect(normalizeAnthropicBaseUrl("ftp://example.com", 100)).toBeNull()
    expect(normalizeAnthropicBaseUrl("", 100)).toBeNull()
  })
})

describe("parseBaseUrlDraft", () => {
  test("a blank draft means the default endpoint", () => {
    expect(parseBaseUrlDraft("   ", 100)).toEqual({ kind: "default" })
  })

  test("a valid draft yields its normalized url", () => {
    expect(parseBaseUrlDraft("https://proxy.local/", 100)).toEqual({ kind: "url", url: "https://proxy.local" })
  })

  test("a non-blank draft that does not normalize is invalid", () => {
    expect(parseBaseUrlDraft("proxy.local", 100)).toEqual({ kind: "invalid" })
  })
})
