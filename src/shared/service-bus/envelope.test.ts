import { describe, expect, test } from "vite-plus/test"
import { busSubject, isBusEnvelope, subjectMatches } from "./envelope"

const envelope = {
  v: 1,
  id: "e1",
  subject: "kanna.chat.created",
  ts: 1,
  source: { kind: "store", log: "chats" },
  direction: "internal",
  idempotencyKey: "store:chat_created:c1:1",
  payload: { chatId: "c1" },
}

describe("subjectMatches", () => {
  test("> matches one or more trailing tokens but never the bare prefix", () => {
    expect(subjectMatches("kanna.>", "kanna.chat.created")).toBe(true)
    expect(subjectMatches("kanna.>", "kanna.chat")).toBe(true)
    expect(subjectMatches("kanna.>", "kanna")).toBe(false)
  })

  test("* matches exactly one token", () => {
    expect(subjectMatches("kanna.*.created", "kanna.chat.created")).toBe(true)
    expect(subjectMatches("kanna.*.created", "kanna.chat.x.created")).toBe(false)
    expect(subjectMatches("kanna.*.created", "kanna.created")).toBe(false)
  })

  test("an exact pattern matches only the identical subject", () => {
    expect(subjectMatches("kanna.chat.created", "kanna.chat.created")).toBe(true)
    expect(subjectMatches("kanna.chat.created", "kanna.chat.renamed")).toBe(false)
    expect(subjectMatches("kanna.chat", "kanna.chat.created")).toBe(false)
  })
})

describe("busSubject", () => {
  test("joins parts under the prefix and replaces characters outside the token alphabet", () => {
    expect(busSubject("chat", "created")).toBe("kanna.chat.created")
    expect(busSubject("hook", "my hook.v2/x")).toBe("kanna.hook.my_hook_v2_x")
  })
})

describe("isBusEnvelope", () => {
  test("accepts a complete envelope", () => {
    expect(isBusEnvelope(envelope)).toBe(true)
  })

  test("rejects an envelope missing its idempotencyKey", () => {
    const { idempotencyKey: _omitted, ...rest } = envelope
    expect(isBusEnvelope(rest)).toBe(false)
  })
})
