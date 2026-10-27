import { describe, expect, test } from "bun:test"
import { isActiveChatStatus, isPrimaryChatInstance } from "./derived"

describe("isPrimaryChatInstance", () => {
  test("returns true when chatId equals activeChatId (non-null)", () => {
    expect(isPrimaryChatInstance("abc", "abc")).toBe(true)
  })

  test("returns false when chatId differs from activeChatId", () => {
    expect(isPrimaryChatInstance("tab-1", "tab-2")).toBe(false)
  })

  test("returns false when chatId is null", () => {
    expect(isPrimaryChatInstance(null, "abc")).toBe(false)
  })

  test("returns false when activeChatId is null", () => {
    expect(isPrimaryChatInstance("abc", null)).toBe(false)
  })

  test("returns false when both are null", () => {
    expect(isPrimaryChatInstance(null, null)).toBe(false)
  })

  test("is case-sensitive", () => {
    expect(isPrimaryChatInstance("Chat-1", "chat-1")).toBe(false)
  })

  test("single-tab invariant: same chatId used for both args is always true (non-null)", () => {
    const id = "chat-xyz-123"
    expect(isPrimaryChatInstance(id, id)).toBe(true)
  })
})

describe("isActiveChatStatus", () => {
  test("is active while a turn is starting, running or waiting for the user", () => {
    expect(isActiveChatStatus("starting")).toBe(true)
    expect(isActiveChatStatus("running")).toBe(true)
    expect(isActiveChatStatus("waiting_for_user")).toBe(true)
  })

  test("is inactive when idle, failed or unknown", () => {
    expect(isActiveChatStatus("idle")).toBe(false)
    expect(isActiveChatStatus("failed")).toBe(false)
    expect(isActiveChatStatus(null)).toBe(false)
  })
})
