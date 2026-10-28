import { describe, expect, test } from "vite-plus/test"
import { unwrapSteeredMessage, wrapSteeredMessage } from "./steered-message"

describe("wrapSteeredMessage", () => {
  test("prepends STEERED_MESSAGE_PREFIX to non-empty content", () => {
    const result = wrapSteeredMessage("keep going")
    expect(result).toContain("<system-message>")
    expect(result).toContain("keep going")
    expect(result.indexOf("<system-message>")).toBeLessThan(result.indexOf("keep going"))
  })

  test("returns just the prefix for empty content", () => {
    const result = wrapSteeredMessage("")
    expect(result).toContain("<system-message>")
    expect(result).toContain("</system-message>")
    const afterTag = result.slice(result.lastIndexOf("</system-message>") + "</system-message>".length)
    expect(afterTag.trim()).toBe("")
  })

  test("returns just the prefix for whitespace-only content", () => {
    const result = wrapSteeredMessage("   ")
    expect(result.indexOf("</system-message>")).toBeGreaterThan(0)
    const afterTag = result.slice(result.lastIndexOf("</system-message>") + "</system-message>".length)
    expect(afterTag.trim()).toBe("")
  })
})

describe("unwrapSteeredMessage", () => {
  test("splits a wrapped message into the instruction and the user body", () => {
    const unwrapped = unwrapSteeredMessage(wrapSteeredMessage("keep going"))
    expect(unwrapped.systemMessage).toContain("inform you of something")
    expect(unwrapped.body).toBe("keep going")
  })

  test("returns an empty body when only the envelope was sent", () => {
    expect(unwrapSteeredMessage(wrapSteeredMessage("")).body).toBe("")
  })

  test("leaves content without an envelope untouched", () => {
    expect(unwrapSteeredMessage("plain text")).toEqual({ systemMessage: null, body: "plain text" })
  })
})
