import { describe, expect, test } from "bun:test"
import type { ChatAutomationEvent } from "./events"

describe("ChatAutomationEvent", () => {
  test("covers the five lifecycle kinds", () => {
    const kinds: ChatAutomationEvent["kind"][] = [
      "auto_continue_proposed",
      "auto_continue_accepted",
      "auto_continue_rescheduled",
      "auto_continue_cancelled",
      "auto_continue_fired",
    ]
    expect(kinds.length).toBe(5)
  })

  test("proposed event carries reset + tz metadata", () => {
    const event: ChatAutomationEvent = {
      v: 3,
      kind: "auto_continue_proposed",
      timestamp: 1_000,
      chatId: "c1",
      scheduleId: "s1",
      detectedAt: 1_000,
      resetAt: 2_000,
      tz: "Asia/Saigon",

    }
    expect(event.tz).toBe("Asia/Saigon")
  })
})
