import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import { messageIdOf, SeenMessageIds } from "./seen-message-ids"

function entry(messageId?: string): TranscriptEntry {
  return { _id: `e-${messageId ?? "none"}`, createdAt: 1, kind: "assistant_text", text: "x", ...(messageId === undefined ? {} : { messageId }) }
}

describe("messageIdOf", () => {
  test("is null for a missing or empty messageId", () => {
    expect(messageIdOf(entry())).toBeNull()
    expect(messageIdOf(entry(""))).toBeNull()
  })

  test("returns a non-empty messageId", () => {
    expect(messageIdOf(entry("m-1"))).toBe("m-1")
  })
})

describe("SeenMessageIds", () => {
  test("records ids per chat and answers membership", () => {
    const seen = new SeenMessageIds()
    seen.record("chat-a", entry("m-1"))

    expect(seen.has("chat-a", "m-1")).toBe(true)
    expect(seen.has("chat-b", "m-1")).toBe(false)
    expect(seen.tracks("chat-a")).toBe(true)
    expect(seen.tracks("chat-b")).toBe(false)
  })

  test("ignores entries without a messageId", () => {
    const seen = new SeenMessageIds()
    seen.record("chat-a", entry())

    expect(seen.tracks("chat-a")).toBe(false)
  })

  test("evicts the oldest id once a chat reaches the cap, whether appended or seeded", () => {
    const seen = new SeenMessageIds(3)
    for (const id of ["m-1", "m-2", "m-3", "m-4"]) seen.record("chat-a", entry(id))

    expect(seen.count("chat-a")).toBe(3)
    expect(seen.has("chat-a", "m-1")).toBe(false)
    expect(seen.has("chat-a", "m-4")).toBe(true)
  })

  test("re-recording a known id does not evict anything", () => {
    const seen = new SeenMessageIds(2)
    seen.record("chat-a", entry("m-1"))
    seen.record("chat-a", entry("m-2"))
    seen.record("chat-a", entry("m-2"))

    expect(seen.has("chat-a", "m-1")).toBe(true)
    expect(seen.count("chat-a")).toBe(2)
  })

  test("forget drops every id of one chat only", () => {
    const seen = new SeenMessageIds()
    seen.record("chat-a", entry("m-1"))
    seen.record("chat-b", entry("m-2"))
    seen.forget("chat-a")

    expect(seen.tracks("chat-a")).toBe(false)
    expect(seen.has("chat-b", "m-2")).toBe(true)
  })
})
