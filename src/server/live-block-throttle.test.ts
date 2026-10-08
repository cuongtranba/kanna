import { describe, expect, test } from "bun:test"
import { createLiveBlockHub, type LiveBlockClock } from "./live-block-throttle"
import type { LiveBlock } from "../shared/live-block"

function fakeClock() {
  let nowMs = 1_000
  const scheduled: { at: number; run: () => void; cancelled: boolean }[] = []
  const clock: LiveBlockClock = {
    now: () => nowMs,
    schedule: (run, delayMs) => {
      const entry = { at: nowMs + delayMs, run, cancelled: false }
      scheduled.push(entry)
      return () => { entry.cancelled = true }
    },
  }
  const advance = (ms: number) => {
    nowMs += ms
    for (const entry of scheduled) {
      if (!entry.cancelled && entry.at <= nowMs) {
        entry.cancelled = true
        entry.run()
      }
    }
  }
  return { clock, advance }
}

function harness() {
  const { clock, advance } = fakeClock()
  const hub = createLiveBlockHub(clock, 100)
  const sent: { chatId: string; block: LiveBlock | null }[] = []
  hub.subscribe((chatId, block) => { sent.push({ chatId, block }) })
  return { hub, advance, sent }
}

const text = (value: string): LiveBlock => ({ kind: "text", text: value })

describe("live block hub", () => {
  test("the first update is sent immediately and later ones coalesce into one trailing send of the latest block", () => {
    const { hub, advance, sent } = harness()
    hub.publish("chat-1", text("a"))
    hub.publish("chat-1", text("ab"))
    hub.publish("chat-1", text("abc"))
    expect(sent).toEqual([{ chatId: "chat-1", block: text("a") }])
    advance(99)
    expect(sent).toHaveLength(1)
    advance(1)
    expect(sent).toEqual([
      { chatId: "chat-1", block: text("a") },
      { chatId: "chat-1", block: text("abc") },
    ])
  })

  test("null is emitted only after one interval, and cancels a pending trailing send", () => {
    const { hub, advance, sent } = harness()
    hub.publish("chat-1", text("a"))
    hub.publish("chat-1", text("ab"))
    hub.publish("chat-1", null)
    expect(sent).toEqual([{ chatId: "chat-1", block: text("a") }])
    advance(99)
    expect(sent).toHaveLength(1)
    advance(1)
    expect(sent).toEqual([
      { chatId: "chat-1", block: text("a") },
      { chatId: "chat-1", block: null },
    ])
    advance(500)
    expect(sent).toHaveLength(2)
  })

  test("a block published during a pending clear cancels the null and is sent one interval after the clear", () => {
    const { hub, advance, sent } = harness()
    hub.publish("chat-1", text("a"))
    advance(100)
    hub.publish("chat-1", null)
    advance(10)
    hub.publish("chat-1", text("next"))
    expect(sent).toEqual([{ chatId: "chat-1", block: text("a") }])
    advance(89)
    expect(sent).toHaveLength(1)
    advance(1)
    expect(sent).toEqual([
      { chatId: "chat-1", block: text("a") },
      { chatId: "chat-1", block: text("next") },
    ])
    advance(500)
    expect(sent).toHaveLength(2)
  })

  test("a block that was never sent is cleared without telling clients", () => {
    const { hub, advance, sent } = harness()
    hub.publish("chat-1", null)
    advance(500)
    expect(sent).toEqual([])
  })

  test("a superseded block is not handed to a late subscriber while a clear is pending", () => {
    const { hub } = harness()
    hub.publish("chat-1", text("a"))
    hub.publish("chat-1", null)
    expect(hub.latest("chat-1")).toBeNull()
  })

  test("the latest block is available to a late subscriber before it has been sent", () => {
    const { hub } = harness()
    hub.publish("chat-1", text("a"))
    hub.publish("chat-1", text("ab"))
    expect(hub.latest("chat-1")).toEqual(text("ab"))
    expect(hub.latest("chat-2")).toBeNull()
  })

  test("chats are throttled independently", () => {
    const { hub, sent } = harness()
    hub.publish("chat-1", text("a"))
    hub.publish("chat-2", text("b"))
    expect(sent.map((s) => s.chatId)).toEqual(["chat-1", "chat-2"])
  })
})
