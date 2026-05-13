import { describe, expect, test } from "bun:test"
import { middleTruncate } from "./middleTruncate"

describe("middleTruncate", () => {
  test("returns name unchanged when under max", () => {
    expect(middleTruncate("chibi-cute.png", 28)).toBe("chibi-cute.png")
  })

  test("preserves short extension when truncating", () => {
    const result = middleTruncate("cute-chibi-portrait-final-v2.png", 20)
    expect(result.endsWith(".png")).toBe(true)
    expect(result).toContain("…")
    expect(result.length).toBeLessThanOrEqual(20)
  })

  test("middles a long extensionless name", () => {
    const result = middleTruncate("a".repeat(20) + "b".repeat(20), 20)
    expect(result).toContain("…")
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result.startsWith("aaaa")).toBe(true)
    expect(result.endsWith("bbbb")).toBe(true)
  })

  test("falls back when extension too long to preserve cleanly", () => {
    const result = middleTruncate("file.verylongextension", 12)
    expect(result).toContain("…")
    expect(result.length).toBeLessThanOrEqual(12)
  })
})
