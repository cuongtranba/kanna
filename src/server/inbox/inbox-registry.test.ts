import { expect, test } from "vite-plus/test"
import { INBOX_MAX_ITEMS } from "../../shared/inbox/types"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import { createInboxHarness } from "../test-helpers/inbox-harness"

let clock = 1_000

function tick(): number {
  clock += 10
  return clock
}

function inbound(deliveryId: string, payload: BusEnvelope["payload"] = { text: "hi" }): BusEnvelope {
  return {
    v: 1,
    id: `env-${deliveryId}`,
    subject: "kanna.webhook.hook1.delivery",
    ts: tick(),
    source: { kind: "webhook", hookId: "hook1", hookName: "CI" },
    direction: "inbound",
    idempotencyKey: `webhook:hook1:${deliveryId}`,
    payload,
  }
}

function internal(subject: string, payload: BusEnvelope["payload"] = {}, chatId?: string): BusEnvelope {
  const id = `i-${tick()}`
  return {
    v: 1,
    id,
    subject,
    ts: clock,
    source: { kind: "store", log: "turns" },
    direction: "internal",
    idempotencyKey: id,
    payload,
    ...(chatId === undefined ? {} : { chatId }),
  }
}

function meta(deliveryId: string, threadKey = "k1") {
  return { threadKey, sender: "ada", sourceName: "CI", deliveryId }
}

test("two deliveries with the same source and thread key share one thread", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  const first = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  const second = await inbox.ingestInbound(inbound("d2"), meta("d2"))
  expect(second.id).toBe(first.id)
  expect(second.messages.map((message) => message.deliveryId)).toEqual(["d1", "d2"])
  expect(inbox.snapshot().threads).toHaveLength(1)
})

test("redelivering the same delivery id does not add a second message", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  await inbox.ingestInbound(inbound("d1"), meta("d1"))
  const again = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  expect(again.messages).toHaveLength(1)
})

test("a new message reopens a replied thread as new and unread", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.markReplied(thread.id, "chat-1", "inbox-reply-1")
  expect(inbox.getThread(thread.id)).toMatchObject({ state: "replied", unread: false, replyCount: 1 })
  await inbox.ingestInbound(inbound("d2"), meta("d2"))
  expect(inbox.getThread(thread.id)).toMatchObject({ state: "new", unread: true, replyCount: 1 })
})

test("a report from a chat that is not the thread handler is refused", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  const refused = await inbox.report(thread.id, "chat-2", "needs_you", "x")
  expect(refused.ok).toBe(false)
  expect(inbox.getThread(thread.id)?.state).toBe("new")
  const accepted = await inbox.report(thread.id, "chat-1", "fyi", "Just so you know", "thanks")
  expect(accepted.ok).toBe(true)
  expect(inbox.getThread(thread.id)).toMatchObject({
    state: "fyi",
    unread: false,
    report: { verdict: "fyi", summary: "Just so you know", draftReply: "thanks" },
  })
})

test("a needs_you report fires the listener once and publishes kanna.inbox.reported", async () => {
  const { inbox, published } = await createInboxHarness({ now: tick })
  const fired: string[] = []
  inbox.onNeedsYou((thread) => fired.push(thread.id))
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.report(thread.id, "chat-1", "needs_you", "Pay the invoice")
  await inbox.report(thread.id, "chat-1", "needs_you", "Still pay it")
  expect(fired).toEqual([thread.id])
  expect(inbox.getThread(thread.id)).toMatchObject({ state: "needs_you", unread: true })
  expect(published.map((envelope) => envelope.subject)).toEqual(["kanna.inbox.reported", "kanna.inbox.reported"])
})

test("a handler turn that ends without a report leaves the thread needs_you", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  const fired: string[] = []
  inbox.onNeedsYou((thread) => fired.push(thread.id))
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.markPending(thread.id, "webhook-hook1-d1")
  bus.publish(internal("kanna.turn.finished", {}, "chat-1"))
  await inbox.flush()
  expect(inbox.getThread(thread.id)).toMatchObject({ state: "needs_you", unread: true, report: { verdict: "needs_you", summary: "" } })
  expect(inbox.getThread(thread.id)?.pendingScheduleId).toBeUndefined()
  expect(fired).toEqual([thread.id])
})

test("a report before the turn ends wins over the fallback", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.bindChat(thread.id, "chat-1")
  await inbox.markPending(thread.id, "s1")
  await inbox.report(thread.id, "chat-1", "handled", "Done")
  bus.publish(internal("kanna.turn.finished", {}, "chat-1"))
  await inbox.flush()
  expect(inbox.getThread(thread.id)?.state).toBe("handled")
})

test("internal envelopes become activity items and only failures ask for attention", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  bus.publish(internal("kanna.chat.created", { title: "Fresh" }))
  bus.publish(internal("kanna.turn.failed", { error: "boom" }, "c1"))
  bus.publish(internal("kanna.cron.runOutcome", { ok: true }))
  bus.publish(internal("kanna.cron.runOutcome", { ok: false }))
  await inbox.flush()
  const items = inbox.snapshot().items
  expect(items).toHaveLength(4)
  expect(items.filter((item) => item.attention).map((item) => item.title).sort()).toEqual(["Cron run failed", "Turn failed"])
  expect(inbox.unreadCount()).toBe(2)
})

test("a tool request stops asking for attention once it is resolved, including after a restart", async () => {
  const { inbox, bus, log } = await createInboxHarness({ now: tick })
  bus.publish(internal("kanna.toolRequest.put", { request: { id: "r1", policyVerdict: "ask", status: "pending" } }, "c1"))
  await inbox.flush()
  expect(inbox.snapshot().items.filter((item) => item.attention)).toHaveLength(1)
  expect(inbox.unreadCount()).toBe(1)
  bus.publish(internal("kanna.toolRequest.resolved", { id: "r1", status: "answered" }))
  await inbox.flush()
  expect(inbox.snapshot().items.filter((item) => item.attention)).toEqual([])
  expect(inbox.unreadCount()).toBe(0)
  const restarted = await createInboxHarness({ now: tick, log })
  expect(restarted.inbox.snapshot().items.filter((item) => item.attention)).toEqual([])
  expect(restarted.inbox.unreadCount()).toBe(0)
})

test("the inbox's own envelopes never become activity items", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.archive(thread.id)
  bus.publish({ ...internal("kanna.inbox.reported"), source: { kind: "inbox" } })
  await inbox.flush()
  expect(inbox.snapshot().items).toEqual([])
})

test("an inbound envelope on the bus is not stored as an activity item", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  bus.publish(inbound("d1"))
  await inbox.flush()
  expect(inbox.snapshot().items).toEqual([])
})

test("2100 activity items are trimmed to the cap and an unread recent thread survives", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  for (let index = 0; index < 2100; index += 1) bus.publish(internal("kanna.chat.created"))
  await inbox.flush()
  const snapshot = inbox.snapshot(5000)
  expect(snapshot.total).toBe(INBOX_MAX_ITEMS)
  expect(snapshot.threads.map((entry) => entry.id)).toEqual([thread.id])
  expect(snapshot.items).toHaveLength(INBOX_MAX_ITEMS - 1)
})

test("a new registry over the same log reproduces the snapshot", async () => {
  const first = await createInboxHarness({ now: tick })
  const thread = await first.inbox.ingestInbound(inbound("d1"), meta("d1"))
  await first.inbox.bindChat(thread.id, "chat-1")
  await first.inbox.report(thread.id, "chat-1", "needs_you", "Look")
  first.bus.publish(internal("kanna.turn.failed", { error: "x" }, "c9"))
  await first.inbox.markRead([thread.id])
  await first.inbox.flush()
  const second = await createInboxHarness({ now: tick, log: first.log })
  expect(second.inbox.snapshot()).toEqual(first.inbox.snapshot())
})

test("a log with more events than twice the live records is rewritten without the dropped ones", async () => {
  const first = await createInboxHarness({ now: tick })
  const thread = await first.inbox.ingestInbound(inbound("d1"), meta("d1"))
  for (let index = 0; index < 40; index += 1) await first.inbox.markAllRead(clock + index)
  await first.inbox.archive(thread.id)
  await first.inbox.flush()
  const before = first.log.events.length
  const second = await createInboxHarness({ now: tick, log: first.log })
  expect(second.log.rewrites).toBe(1)
  expect(second.log.events.length).toBeLessThan(before)
  expect(second.inbox.snapshot()).toEqual(first.inbox.snapshot())
})

test("markAllRead clears unread on everything before the cut-off", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  await inbox.ingestInbound(inbound("d1"), meta("d1"))
  bus.publish(internal("kanna.turn.failed", {}, "c1"))
  await inbox.flush()
  expect(inbox.unreadCount()).toBe(2)
  await inbox.markAllRead()
  expect(inbox.unreadCount()).toBe(0)
})

test("archive moves a thread out of the open states", async () => {
  const { inbox, published } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  await inbox.archive(thread.id)
  expect(inbox.getThread(thread.id)).toMatchObject({ state: "archived", unread: false })
  expect(published.map((envelope) => envelope.subject)).toEqual(["kanna.inbox.archived"])
})

test("page filters by source kind and attention and pages by timestamp", async () => {
  const { inbox, bus } = await createInboxHarness({ now: tick })
  await inbox.ingestInbound(inbound("d1"), meta("d1"))
  bus.publish(internal("kanna.chat.created"))
  bus.publish(internal("kanna.turn.failed", {}, "c1"))
  await inbox.flush()
  const attention = inbox.page(Number.MAX_SAFE_INTEGER, 10, { attentionOnly: true })
  expect(attention.items.map((item) => item.subject)).toEqual(["kanna.turn.failed"])
  expect(attention.threads).toHaveLength(1)
  const webhooks = inbox.page(Number.MAX_SAFE_INTEGER, 10, { sourceKind: "webhook" })
  expect(webhooks.items).toEqual([])
  expect(webhooks.threads).toHaveLength(1)
  const older = inbox.page(attention.items[0].ts, 10, {})
  expect(older.items.map((item) => item.subject)).toEqual(["kanna.chat.created"])
})
