import { expect, test } from "bun:test"
import type { JsonValue } from "../json"
import { isAttention, inboxTab, raisesNotification } from "./policy"
import type { InboxActivityItem, InboxThread, InboxThreadState } from "./types"

function thread(state: InboxThreadState): InboxThread {
  return {
    id: "t",
    sourceKind: "webhook",
    sourceId: "h",
    sourceName: "CI",
    threadKey: "k",
    sender: "s",
    messages: [],
    state,
    unread: true,
    lastMessageAt: 1,
    replyCount: 0,
  }
}

function item(attention: boolean): InboxActivityItem {
  return {
    id: "i",
    ts: 1,
    subject: "kanna.turn.failed",
    source: { kind: "store", log: "turns" },
    title: "t",
    preview: "p",
    payload: {},
    attention,
    unread: true,
  }
}

function attention(subject: string, payload: JsonValue): boolean {
  return isAttention({ subject, payload })
}

test("failed turns, tool requests and failed subagents ask for attention", () => {
  expect(attention("kanna.turn.failed", {})).toBe(true)
  expect(attention("kanna.toolRequest.put", {})).toBe(true)
  expect(attention("kanna.subagent.failed", {})).toBe(true)
  expect(attention("kanna.turn.finished", {})).toBe(false)
})

test("cron and loop outcomes ask for attention only when they failed", () => {
  expect(attention("kanna.cron.runOutcome", { ok: false })).toBe(true)
  expect(attention("kanna.cron.runOutcome", { ok: true })).toBe(false)
  expect(attention("kanna.loop.runOutcome", { ok: false })).toBe(true)
  expect(attention("kanna.loop.runOutcome", { ok: true })).toBe(false)
})

test("the Inbox tab lists open threads and attention items only", () => {
  expect(inboxTab(thread("new"))).toBe(true)
  expect(inboxTab(thread("needs_you"))).toBe(true)
  expect(inboxTab(thread("fyi"))).toBe(true)
  expect(inboxTab(thread("handled"))).toBe(false)
  expect(inboxTab(thread("replied"))).toBe(false)
  expect(inboxTab(thread("archived"))).toBe(false)
  expect(inboxTab(item(true))).toBe(true)
  expect(inboxTab(item(false))).toBe(false)
})

test("only a needs_you thread raises a notification", () => {
  expect(raisesNotification(thread("needs_you"))).toBe(true)
  expect(raisesNotification(thread("fyi"))).toBe(false)
})
