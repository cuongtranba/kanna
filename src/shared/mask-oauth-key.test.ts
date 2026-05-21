import { describe, expect, test } from "bun:test"
import { maskOauthKey } from "./mask-oauth-key"

describe("maskOauthKey", () => {
  test("masks a typical OAuth token to prefix-12 + suffix-4", () => {
    const token = "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz1234"
    const masked = maskOauthKey(token)
    expect(masked).toBe("sk-ant-oat01...1234")
  })

  test("returns *** for empty input", () => {
    expect(maskOauthKey("")).toBe("***")
  })

  test("returns *** for tokens shorter than prefix+suffix+4", () => {
    expect(maskOauthKey("short")).toBe("***")
    expect(maskOauthKey("sk-ant-oat01-abcd")).toBe("***")
  })

  test("never leaks more than the suffix tail of the token", () => {
    const token = "sk-ant-oat01-SECRETMIDDLESEGMENT1234"
    const masked = maskOauthKey(token)
    expect(masked).not.toContain("SECRETMIDDLE")
    expect(masked.endsWith("1234")).toBe(true)
  })

  test("output length is bounded by prefix + ... + suffix", () => {
    const token = "x".repeat(500)
    const masked = maskOauthKey(token)
    expect(masked.length).toBe(12 + 3 + 4)
  })
})
