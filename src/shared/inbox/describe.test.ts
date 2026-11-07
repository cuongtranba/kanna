import { expect, test } from "vite-plus/test"
import type { BusEnvelope } from "../service-bus/envelope"
import { describeEnvelope, describeMessageText } from "./describe"

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
  expect(describeMessageText("hello   world").preview).toBe("hello world")
  expect(describeMessageText({ name: "Ada", n: 1 }).preview).toBe("Ada")
  expect(describeMessageText({ n: 1 }).preview).toBe('{"n":1}')
})

test("full message text keeps its line breaks and is kept only when the preview loses something", () => {
  expect(describeMessageText("hello").text).toBeUndefined()
  expect(describeMessageText("line one\nline two").text).toBe("line one\nline two")
  expect(describeMessageText("x".repeat(5000)).text).toHaveLength(4000)
})
