import { describe, expect, test } from "vite-plus/test"
import { generateShareToken, isShareTokenId } from "./token"

describe("token", () => {
  test("generateShareToken produces 43-char base64url (32 raw bytes)", () => {
    const t = generateShareToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test("two generations differ", () => {
    expect(generateShareToken()).not.toBe(generateShareToken())
  })

  test("a generated token is a share token id, and strings the generator never emits are not", () => {
    expect(isShareTokenId(generateShareToken())).toBe(true)
    expect(isShareTokenId("short")).toBe(false)
    expect(isShareTokenId(`${"a".repeat(19)}/`)).toBe(false)
    expect(isShareTokenId("a".repeat(129))).toBe(false)
  })
})
