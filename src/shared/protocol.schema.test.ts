import { describe, expect, test } from "bun:test"
import { parseClientEnvelope } from "./protocol.schema"

describe("parseClientEnvelope", () => {
  test("accepts a subscribe envelope with a known topic", () => {
    expect(parseClientEnvelope({ v: 1, type: "subscribe", id: "s1", topic: { type: "chat", chatId: "c1", recentLimit: 5 } }))
      .toEqual({ v: 1, type: "subscribe", id: "s1", topic: { type: "chat", chatId: "c1", recentLimit: 5 } })
  })

  test("a subscribe with a missing or unknown topic is refused instead of reaching the handler", () => {
    expect(parseClientEnvelope({ v: 1, type: "subscribe", id: "s1" })).toBeNull()
    expect(parseClientEnvelope({ v: 1, type: "subscribe", id: "s1", topic: { type: "nope" } })).toBeNull()
    expect(parseClientEnvelope({ v: 1, type: "subscribe", id: "s1", topic: { type: "chat" } })).toBeNull()
  })

  test("a command envelope carries its unvalidated command for the registry to check", () => {
    expect(parseClientEnvelope({ v: 1, type: "command", id: "k1", command: { type: "chat.cancel", chatId: "c1" } }))
      .toEqual({ v: 1, type: "command", id: "k1", command: { type: "chat.cancel", chatId: "c1" } })
    expect(parseClientEnvelope({ v: 1, type: "command", id: "k1" })).toMatchObject({ type: "command", command: null })
  })

  test("refuses an unknown envelope type, a wrong version and a non-object", () => {
    expect(parseClientEnvelope({ v: 1, type: "ping", id: "x" })).toBeNull()
    expect(parseClientEnvelope({ v: 2, type: "unsubscribe", id: "x" })).toBeNull()
    expect(parseClientEnvelope("subscribe")).toBeNull()
  })
})
