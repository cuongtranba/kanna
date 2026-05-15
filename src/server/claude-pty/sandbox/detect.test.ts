import { describe, expect, test } from "bun:test"
import { detectBwrap, resetBwrapCacheForTest } from "./detect"

describe("detectBwrap", () => {
  test("returns boolean (real platform check)", async () => {
    resetBwrapCacheForTest()
    const result = await detectBwrap()
    expect(typeof result).toBe("boolean")
  })

  test("subsequent calls hit cache (same result)", async () => {
    resetBwrapCacheForTest()
    const first = await detectBwrap()
    const second = await detectBwrap()
    expect(second).toBe(first)
  })
})
