import { expect, test } from "bun:test"
import type { BusEnvelope } from "../service-bus/envelope"
import { describeEnvelope, previewOfPayload } from "./describe"

function envelope(subject: string, payload: BusEnvelope["payload"]): BusEnvelope {
  return {
    v: 1,
    id: "e1",
    subject,
    ts: 1,
    source: { kind: "store", log: "turns" },
    direction: "internal",
    idempotencyKey: "k",
    payload,
  }
}

test("a failed turn reads as Turn failed with the error as its preview", () => {
  expect(describeEnvelope(envelope("kanna.turn.failed", { error: "boom" }))).toEqual({ title: "Turn failed", preview: "boom" })
})

test("a cron outcome names whether the run succeeded", () => {
  expect(describeEnvelope(envelope("kanna.cron.runOutcome", { ok: false })).title).toBe("Cron run failed")
  expect(describeEnvelope(envelope("kanna.cron.runOutcome", { ok: true })).title).toBe("Cron run ok")
})

test("an unknown subject falls back to the subject for both fields", () => {
  expect(describeEnvelope(envelope("kanna.stack.added", {}))).toEqual({ title: "kanna.stack.added", preview: "kanna.stack.added" })
})

test("a long preview is flattened and cut at 160 characters", () => {
  const { preview } = describeEnvelope(envelope("kanna.chat.created", { title: `a\n${"b".repeat(400)}` }))
  expect(preview.length).toBe(160)
  expect(preview.endsWith("…")).toBe(true)
})

test("an inbound payload previews as its text or its first readable field", () => {
  expect(previewOfPayload("hello   world")).toBe("hello world")
  expect(previewOfPayload({ name: "Ada", n: 1 })).toBe("Ada")
  expect(previewOfPayload({ n: 1 })).toBe('{"n":1}')
})
