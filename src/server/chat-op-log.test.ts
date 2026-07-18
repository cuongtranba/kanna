import { describe, expect, test } from "bun:test"
import { ChatOpLog } from "./chat-op-log"
import type { ChatOp } from "../shared/chat-ops"

function op(id: string): ChatOp {
  return { kind: "entries.append", entries: [{ _id: id, createdAt: 1, kind: "assistant_text", text: id }] }
}

describe("ChatOpLog", () => {
  test("record increments seq per chat independently", () => {
    const log = new ChatOpLog()
    expect(log.record("a", op("1"))).toBe(1)
    expect(log.record("a", op("2"))).toBe(2)
    expect(log.record("b", op("1"))).toBe(1)
    expect(log.currentSeq("a")).toBe(2)
    expect(log.currentSeq("b")).toBe(1)
    expect(log.currentSeq("unknown")).toBe(0)
  })

  test("since(chat, 0) returns all recorded ops in order", () => {
    const log = new ChatOpLog()
    log.record("a", op("1"))
    log.record("a", op("2"))
    log.record("a", op("3"))
    const res = log.since("a", 0)
    expect(res).not.toBeNull()
    expect(res!.fromSeq).toBe(1)
    expect(res!.toSeq).toBe(3)
    expect(res!.ops).toHaveLength(3)
  })

  test("since at current seq returns empty batch", () => {
    const log = new ChatOpLog()
    log.record("a", op("1"))
    const res = log.since("a", 1)
    expect(res).toEqual({ ops: [], fromSeq: 2, toSeq: 1 })
  })

  test("since beyond ring cap returns null (gap)", () => {
    const log = new ChatOpLog(4)
    for (let i = 1; i <= 10; i++) log.record("a", op(String(i)))
    expect(log.since("a", 0)).toBeNull()
    expect(log.since("a", 5)).toBeNull()
    const ok = log.since("a", 6)
    expect(ok).not.toBeNull()
    expect(ok!.fromSeq).toBe(7)
    expect(ok!.toSeq).toBe(10)
    expect(ok!.ops).toHaveLength(4)
  })

  test("since for unknown chat with afterSeq 0 returns empty batch", () => {
    const log = new ChatOpLog()
    expect(log.since("nope", 0)).toEqual({ ops: [], fromSeq: 1, toSeq: 0 })
  })

  test("clear resets chat to seq 0", () => {
    const log = new ChatOpLog()
    log.record("a", op("1"))
    log.clear("a")
    expect(log.currentSeq("a")).toBe(0)
    expect(log.since("a", 0)).toEqual({ ops: [], fromSeq: 1, toSeq: 0 })
  })
})
