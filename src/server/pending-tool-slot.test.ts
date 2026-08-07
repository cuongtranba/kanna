import { describe, expect, test } from "bun:test"
import { PendingToolSlots, type ParkedTool } from "./pending-tool-slot"
import type { NormalizedToolCall } from "../shared/types"
import type { AnyValue } from "../shared/errors"

function askTool(toolId: string): NormalizedToolCall & { toolKind: "ask_user_question" } {
  return {
    toolId,
    toolKind: "ask_user_question",
    toolName: "AskUserQuestion",
    displayName: "AskUserQuestion",
    input: { questions: [] },
  } as unknown as NormalizedToolCall & { toolKind: "ask_user_question" }
}

function park(
  slots: PendingToolSlots,
  chatId: string,
  toolId: string,
  onResolve?: (result: AnyValue) => void,
): ParkedTool {
  return slots.park(chatId, {
    toolUseId: toolId,
    provider: "claude",
    tool: askTool(toolId),
    parkedAt: 1000,
    resolve: onResolve ?? (() => {}),
  })
}

describe("PendingToolSlots", () => {
  test("park then get returns the parked request", () => {
    const slots = new PendingToolSlots()
    park(slots, "chat-1", "tool-1")
    expect(slots.get("chat-1")?.toolUseId).toBe("tool-1")
    expect(slots.get("chat-2")).toBeNull()
    expect(slots.has("chat-1")).toBe(true)
    expect(slots.has("chat-2")).toBe(false)
  })

  test("take removes and returns the slot when toolUseId matches, without resolving", () => {
    const slots = new PendingToolSlots()
    let resolved: AnyValue = null
    park(slots, "chat-1", "tool-1", (r) => { resolved = r })
    const taken = slots.take("chat-1", "tool-1")
    expect(taken?.toolUseId).toBe("tool-1")
    expect(resolved).toBeNull()
    expect(slots.has("chat-1")).toBe(false)
  })

  test("take returns null on toolUseId mismatch and keeps the slot", () => {
    const slots = new PendingToolSlots()
    park(slots, "chat-1", "tool-1")
    expect(slots.take("chat-1", "tool-other")).toBeNull()
    expect(slots.has("chat-1")).toBe(true)
  })

  test("take returns null for an empty chat", () => {
    const slots = new PendingToolSlots()
    expect(slots.take("chat-1", "tool-1")).toBeNull()
  })

  test("discard removes the slot and resolves it with the discarded payload", () => {
    const slots = new PendingToolSlots()
    let resolved: AnyValue = null
    park(slots, "chat-1", "tool-1", (r) => { resolved = r })
    const discarded = slots.discard("chat-1")
    expect(discarded?.parked.toolUseId).toBe("tool-1")
    expect(discarded?.result).toEqual({ discarded: true, answers: {} })
    expect(resolved).toEqual({ discarded: true, answers: {} })
    expect(slots.has("chat-1")).toBe(false)
  })

  test("discard on an empty chat is a null no-op", () => {
    const slots = new PendingToolSlots()
    expect(slots.discard("chat-1")).toBeNull()
  })

  test("parking over an occupied slot discards the prior request first", () => {
    const slots = new PendingToolSlots()
    let firstResolved: AnyValue = null
    park(slots, "chat-1", "tool-1", (r) => { firstResolved = r })
    park(slots, "chat-1", "tool-2")
    expect(firstResolved).toEqual({ discarded: true, answers: {} })
    expect(slots.get("chat-1")?.toolUseId).toBe("tool-2")
  })

  test("slots are isolated per chat", () => {
    const slots = new PendingToolSlots()
    park(slots, "chat-1", "tool-1")
    park(slots, "chat-2", "tool-2")
    slots.discard("chat-1")
    expect(slots.has("chat-1")).toBe(false)
    expect(slots.get("chat-2")?.toolUseId).toBe("tool-2")
  })
})
