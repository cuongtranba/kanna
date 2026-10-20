import { describe, expect, test } from "bun:test"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createMirrorQueue } from "./nats-mirror-queue"

function envelope(id: string): BusEnvelope {
  return { v: 1, id, subject: "kanna.test", ts: 1, source: { kind: "inbox" }, direction: "internal", idempotencyKey: id, payload: {} }
}

describe("createMirrorQueue", () => {
  test("keeps order and drops the oldest when full, counting each drop", () => {
    const queue = createMirrorQueue(3)
    for (const id of ["a", "b", "c", "d", "e"]) queue.push(envelope(id))

    expect(queue.size()).toBe(3)
    expect(queue.dropped()).toBe(2)
    expect(queue.shift()?.envelope.id).toBe("c")
  })

  test("returns a failed item to the head exactly once", () => {
    const queue = createMirrorQueue(3)
    queue.push(envelope("a"))
    queue.push(envelope("b"))
    const first = queue.shift()
    if (first === undefined) throw new Error("empty")

    expect(queue.requeueHead(first)).toBe(true)
    const again = queue.shift()
    expect(again?.envelope.id).toBe("a")
    if (again === undefined) throw new Error("empty")
    expect(queue.requeueHead(again)).toBe(false)
    expect(queue.peek()?.envelope.id).toBe("b")
  })
})
