import { describe, expect, test } from "vite-plus/test"
import { liveRecord, requireLiveChat, requireLiveProject, requireLiveStack } from "./event-store-lookup"

const records = new Map<string, { id: string; deletedAt?: number }>([
  ["live", { id: "live" }],
  ["gone", { id: "gone", deletedAt: 5 }],
])

describe("liveRecord", () => {
  test("returns a record that exists and is not soft-deleted", () => {
    expect(liveRecord(records, "live")?.id).toBe("live")
  })

  test("returns null for a missing or soft-deleted record", () => {
    expect(liveRecord(records, "missing")).toBeNull()
    expect(liveRecord(records, "gone")).toBeNull()
  })
})

describe("requireLive*", () => {
  test("return the live record", () => {
    expect(requireLiveChat(records, "live").id).toBe("live")
    expect(requireLiveProject(records, "live").id).toBe("live")
    expect(requireLiveStack(records, "live").id).toBe("live")
  })

  test("throw a kind-specific message for a missing or soft-deleted record", () => {
    expect(() => requireLiveChat(records, "gone")).toThrow("Chat not found")
    expect(() => requireLiveProject(records, "missing")).toThrow("Project not found")
    expect(() => requireLiveStack(records, "gone")).toThrow("Stack not found")
  })

  test("a project lookup can name the missing id in the message", () => {
    expect(() => requireLiveProject(records, "missing", { namedInError: true })).toThrow("Project not found: missing")
  })
})
