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

async function threadWithHandler(harness: Awaited<ReturnType<typeof createInboxHarness>>) {
  const thread = await harness.inbox.ingestInbound(inbound("d1"), meta("d1"))
  await harness.inbox.bindChat(thread.id, "chat-1")
  return thread
}

test("a report with a draft reply keeps it as a triage draft version and a report without one adds none", async () => {
  const harness = await createInboxHarness({ now: tick })
  const thread = await threadWithHandler(harness)
  await harness.inbox.report(thread.id, "chat-1", "fyi", "Nothing to say")
  expect(harness.inbox.getThread(thread.id)?.drafts).toEqual([])
  await harness.inbox.report(thread.id, "chat-1", "needs_you", "Pay it", "  On it, thanks  ")
  expect(harness.inbox.getThread(thread.id)?.drafts).toEqual([
    { id: expect.any(String), text: "On it, thanks", at: expect.any(Number), origin: "triage" },
  ])
})

test("a draft requested by an instruction is an ask draft that remembers the instruction", async () => {
  const harness = await createInboxHarness({ now: tick })
  const thread = await threadWithHandler(harness)
  await harness.inbox.markPending(thread.id, `inbox-instruct-${thread.id}-1`, "Make it shorter")
  await harness.inbox.report(thread.id, "chat-1", "needs_you", "Rewritten", "Thanks")
  expect(harness.inbox.getThread(thread.id)?.drafts).toEqual([
    { id: expect.any(String), text: "Thanks", at: expect.any(Number), origin: "ask", instruction: "Make it shorter" },
  ])
  await harness.inbox.markPending(thread.id, "webhook-hook1-d2")
  await harness.inbox.report(thread.id, "chat-1", "needs_you", "Again", "Thanks again")
  expect(harness.inbox.getThread(thread.id)?.drafts.map((draft) => draft.origin)).toEqual(["ask", "triage"])
})

test("only the five newest drafts of a thread are kept, oldest dropped first", async () => {
  const harness = await createInboxHarness({ now: tick })
  const thread = await threadWithHandler(harness)
  for (let index = 1; index <= 6; index += 1) {
    await harness.inbox.report(thread.id, "chat-1", "needs_you", "s", `draft ${index}`)
  }
  expect(harness.inbox.getThread(thread.id)?.drafts.map((draft) => draft.text)).toEqual([
    "draft 2",
    "draft 3",
    "draft 4",
    "draft 5",
    "draft 6",
  ])
})

test("draft versions survive a restart and a new inbound message", async () => {
  const first = await createInboxHarness({ now: tick })
  const thread = await threadWithHandler(first)
  await first.inbox.report(thread.id, "chat-1", "needs_you", "s", "keep me")
  await first.inbox.ingestInbound(inbound("d2"), meta("d2"))
  expect(first.inbox.getThread(thread.id)?.report).toBeUndefined()
  expect(first.inbox.getThread(thread.id)?.drafts.map((draft) => draft.text)).toEqual(["keep me"])
  const second = await createInboxHarness({ now: tick, log: first.log })
  expect(second.inbox.getThread(thread.id)?.drafts).toEqual(first.inbox.getThread(thread.id)?.drafts)
})

async function boundThread() {
  const harness = await createInboxHarness({ now: tick })
  const thread = await harness.inbox.ingestInbound(inbound("d1"), meta("d1"))
  await harness.inbox.bindChat(thread.id, "chat-1")
  return { ...harness, thread }
}

const PROPOSE = { text: "On it.", confidence: 0.9, reason: "Clear request" }

test("propose_send from a chat that is not the thread's handler is refused and never reaches the autonomy decision", async () => {
  const { inbox, thread } = await boundThread()
  const proposals: string[] = []
  inbox.onProposeSend(async (_threadId, proposal) => { proposals.push(proposal.text) })

  const refused = await inbox.report(thread.id, "chat-2", "needs_you", "x", undefined, PROPOSE)
  const accepted = await inbox.report(thread.id, "chat-1", "needs_you", "x", undefined, PROPOSE)

  expect(refused.ok).toBe(false)
  expect(accepted.ok).toBe(true)
  expect(proposals).toEqual(["On it."])
})

test("propose_send text is trimmed and its confidence is clamped before the decision sees it", async () => {
  const { inbox, thread } = await boundThread()
  const seen: { text: string; confidence: number }[] = []
  inbox.onProposeSend(async (_threadId, proposal) => { seen.push(proposal) })

  await inbox.report(thread.id, "chat-1", "needs_you", "x", undefined, { text: "  hi  ", confidence: 7, reason: "r" })
  await inbox.report(thread.id, "chat-1", "needs_you", "x", undefined, { text: "   ", confidence: 0.5, reason: "r" })

  expect(seen).toEqual([{ text: "hi", confidence: 1, reason: "r" }])
})

test("a new proposal expires the previous open one", async () => {
  const { inbox, thread } = await boundThread()
  const proposal = { text: "first", confidence: 0.5, reason: "r", at: 1, status: "open" as const }
  await inbox.addProposal(thread.id, { id: "p1", ...proposal })
  await inbox.addProposal(thread.id, { id: "p2", ...proposal, text: "second" })

  expect(inbox.getThread(thread.id)?.proposal).toMatchObject({ id: "p2", text: "second" })
  expect(await inbox.resolveProposal(thread.id, "p1", "rejected")).toBe(false)
})

test("a pause blocks until it is cleared, and the override, pause and proposal survive a restart", async () => {
  const { inbox, thread, log, bus } = await boundThread()
  await inbox.setThreadAutonomy(thread.id, "approve")
  await inbox.pauseAgent(thread.id, 9_999)
  await inbox.addProposal(thread.id, { id: "p1", text: "t", confidence: 0.5, reason: "r", at: 1, status: "open", blockedBy: "why" })
  await inbox.flush()

  const { inbox: replayed } = await createInboxHarness({ now: tick, log, bus })
  expect(replayed.getThread(thread.id)).toMatchObject({ autonomy: "approve", agentPausedUntil: 9_999, proposal: { id: "p1", blockedBy: "why" } })

  await replayed.pauseAgent(thread.id, null)
  await replayed.setThreadAutonomy(thread.id, null)
  const cleared = replayed.getThread(thread.id)
  expect(cleared?.agentPausedUntil).toBeUndefined()
  expect(cleared?.autonomy).toBeUndefined()
})

test("agent sends are counted per source within the window", async () => {
  const { inbox, thread } = await boundThread()
  await inbox.queueOutbound(thread.id, { id: "o1", text: "a", by: "agent" })
  await inbox.queueOutbound(thread.id, { id: "o2", text: "b", by: "you" })
  await inbox.queueOutbound(thread.id, { id: "o3", text: "c", by: "approved" })

  expect(inbox.agentSendCount("hook1", 0)).toBe(1)
  expect(inbox.agentSendCount("hook1", clock + 1_000_000)).toBe(0)
  expect(inbox.agentSendCount("other", 0)).toBe(0)
})

test("the sent-by-agent page filter keeps only threads the agent replied on", async () => {
  const { inbox, thread } = await boundThread()
  const other = await inbox.ingestInbound({ ...inbound("d9"), id: "env-other" }, { ...meta("d9", "k2") })
  await inbox.queueOutbound(thread.id, { id: "o1", text: "hi", by: "agent" })
  await inbox.queueOutbound(other.id, { id: "o2", text: "hi", by: "you" })

  const page = inbox.page(Number.MAX_SAFE_INTEGER, 10, { sentByAgent: true })

  expect(page.threads.map((entry) => entry.id)).toEqual([thread.id])
})

test("a muted sender's messages are recorded without counting as unread, and unmuting does not mark them unread", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  const thread = await inbox.ingestInbound(inbound("d1"), meta("d1"))
  expect(inbox.unreadCount()).toBe(1)
  await inbox.setSenderMuted(thread.id, true)
  await inbox.ingestInbound(inbound("d2"), meta("d2"))
  expect(inbox.getThread(thread.id)).toMatchObject({ muted: true, unread: false })
  expect(inbox.getThread(thread.id)?.messages).toHaveLength(2)
  expect(inbox.unreadCount()).toBe(0)
  await inbox.setSenderMuted(thread.id, false)
  expect(inbox.getThread(thread.id)).toMatchObject({ muted: false, unread: false })
})

test("muting applies to every thread of that sender on that source and to no other sender", async () => {
  const { inbox } = await createInboxHarness({ now: tick })
  const ada = await inbox.ingestInbound(inbound("d1"), meta("d1", "k1"))
  const adaAgain = await inbox.ingestInbound(inbound("d2"), meta("d2", "k2"))
  const bob = await inbox.ingestInbound(inbound("d3"), { ...meta("d3", "k3"), sender: "bob" })
  await inbox.setSenderMuted(ada.id, true)
  expect(inbox.getThread(adaAgain.id)?.muted).toBe(true)
  expect(inbox.getThread(bob.id)?.muted).toBe(false)
})

test("a mute survives a restart over the same log and applies to threads created afterwards", async () => {
  const first = await createInboxHarness({ now: tick })
  const thread = await first.inbox.ingestInbound(inbound("d1"), meta("d1"))
  await first.inbox.setSenderMuted(thread.id, true)
  const second = await createInboxHarness({ now: tick, log: first.log })
  expect(second.inbox.getThread(thread.id)?.muted).toBe(true)
  const later = await second.inbox.ingestInbound(inbound("d2"), meta("d2", "k2"))
  expect(later).toMatchObject({ muted: true, unread: false })
})

test("a message received while muted stays read after unmute, compaction and restart", async () => {
  const first = await createInboxHarness({ now: tick })
  const thread = await first.inbox.ingestInbound(inbound("d1"), meta("d1"))
  await first.inbox.setSenderMuted(thread.id, true)
  await first.inbox.ingestInbound(inbound("d2"), meta("d2"))
  await first.inbox.setSenderMuted(thread.id, false)
  for (let index = 0; index < 40; index += 1) await first.inbox.markAllRead(0)
  await first.inbox.flush()
  const second = await createInboxHarness({ now: tick, log: first.log })
  expect(second.log.rewrites).toBe(1)
  const third = await createInboxHarness({ now: tick, log: second.log })
  expect(third.inbox.getThread(thread.id)).toMatchObject({ muted: false, unread: false })
  expect(third.inbox.unreadCount()).toBe(0)
})

test("muting an unknown thread does nothing", async () => {
  const { inbox, log } = await createInboxHarness({ now: tick })
  await inbox.setSenderMuted("missing", true)
  expect(log.events).toEqual([])
})
