import { describe, expect, test } from "bun:test"
import { detectModelSwitch, detectRateLimit, stripAnsi } from "./frame-parser"

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
  })
})

describe("detectModelSwitch", () => {
  test("returns model when 'Model:' line present", () => {
    expect(detectModelSwitch("⏵⏵ Model: claude-sonnet-4-6\n")).toBe("claude-sonnet-4-6")
  })
  test("returns null when no model line", () => {
    expect(detectModelSwitch("nothing here")).toBeNull()
  })
})

describe("detectRateLimit", () => {
  test("returns resetAt when banner contains 'resets at HH:MM'", () => {
    const result = detectRateLimit("Rate limit hit. Resets at 14:30 PT")
    expect(result).not.toBeNull()
    expect(result?.tz).toBe("PT")
  })
  test("returns null when no rate-limit banner", () => {
    expect(detectRateLimit("everything is fine")).toBeNull()
  })
})
