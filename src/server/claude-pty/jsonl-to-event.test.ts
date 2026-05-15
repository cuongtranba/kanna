import { describe, expect, test } from "bun:test"
import { parseJsonlLine } from "./jsonl-to-event"

describe("parseJsonlLine", () => {
  test("ignores empty lines", () => {
    expect(parseJsonlLine("")).toEqual([])
    expect(parseJsonlLine("   ")).toEqual([])
  })

  test("ignores malformed JSON (logs but does not throw)", () => {
    expect(parseJsonlLine("{not json")).toEqual([])
  })

  test("system.init → session_token event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "claude-sonnet-4-6",
    })
    const events = parseJsonlLine(line)
    const sessionTokenEvent = events.find((e) => e.type === "session_token")
    expect(sessionTokenEvent).toBeDefined()
    expect(sessionTokenEvent?.sessionToken).toBe("sess-1")
  })

  test("assistant message → transcript event with assistant role", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    })
    const events = parseJsonlLine(line)
    const transcriptEvents = events.filter((e) => e.type === "transcript")
    expect(transcriptEvents.length).toBeGreaterThan(0)
  })

  test("system.rate_limit subtype → rate_limit event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "rate_limit",
      resetAt: 1748800000000,
      tz: "PT",
    })
    const events = parseJsonlLine(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeDefined()
    expect(rl?.rateLimit?.tz).toBe("PT")
  })

  test("system.informational without rate-limit content → no rate_limit event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "informational",
      content: "Remote Control failed to connect",
    })
    const events = parseJsonlLine(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeUndefined()
  })
})
