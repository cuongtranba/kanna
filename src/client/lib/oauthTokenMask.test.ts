import { describe, expect, test } from "bun:test"
import { maskToken } from "./oauthTokenMask"

describe("maskToken", () => {
  test("preserves sk-ant- prefix and last 4 characters", () => {
    expect(maskToken("sk-ant-abcdefghijklmnop")).toBe("sk-ant-…mnop")
  })
  test("returns em-dash placeholder for empty input", () => {
    expect(maskToken("")).toBe("—")
  })
  test("handles short tokens without sk-ant- prefix", () => {
    expect(maskToken("abc")).toBe("…abc")
  })
})
