import { expect, test } from "vite-plus/test"
import type { InboundHandler } from "../../shared/inbound/handler"
import { INBOX_REPORT_TOOL_NAME } from "../../shared/tools"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { deliverInbound, type InboundDelivery } from "./deliver-inbound"

function handler(overrides: Partial<InboundHandler>): InboundHandler {
  return { mode: "spawn", template: "{{subject}}", replyHint: "", pushEnabled: true, ...overrides }
}

function delivery(overrides: Partial<InboundDelivery>, handlerOverrides: Partial<InboundHandler> = {}): InboundDelivery {
  return {
    source: { kind: "mcp", sourceId: "mail1", sourceName: "Mail", serverId: "srv", serverName: "mail-server" },
    sourceName: "Mail",
    handler: handler(handlerOverrides),
    deliveryId: "d1",
    body: { subject: "Invoice due" },
    threadKey: "thread-a",
    sender: "ada@example.com",
    at: 10,
    ...overrides,
  }
}

test("spawn creates one chat per thread, names it after the source and sender, and reuses it", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const first = await deliverInbound(store, agent, bus, inbox, delivery({}, { projectId: project.id }))
  const second = await deliverInbound(store, agent, bus, inbox, delivery({ deliveryId: "d2" }, { projectId: project.id }))
  if (!first.ok || !second.ok) throw new Error("delivery failed")
  expect(second.chatId).toBe(first.chatId)
  expect(second.threadId).toBe(first.threadId)
  expect(store.getChat(first.chatId ?? "")?.title).toBe("Mail · ada@example.com")
  expect(store.listChatsByProject(project.id).filter((chat) => chat.title === "Mail · ada@example.com")).toHaveLength(1)
  expect(store.getQueuedMessages(first.chatId ?? "")).toHaveLength(2)
  expect(inbox.getThread(first.threadId)).toMatchObject({ chatId: first.chatId, pendingScheduleId: "mcp-mail1-d2" })
})

test("a different thread key spawns a different chat", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const first = await deliverInbound(store, agent, bus, inbox, delivery({}, { projectId: project.id }))
  const other = await deliverInbound(store, agent, bus, inbox, delivery({ threadKey: "thread-b" }, { projectId: project.id }))
  if (!first.ok || !other.ok) throw new Error("delivery failed")
  expect(other.chatId).not.toBe(first.chatId)
})

test("the queued prompt carries the template, the untrusted block and the handler instruction for the thread", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const result = await deliverInbound(store, agent, bus, inbox, delivery({}, { projectId: project.id, replyHint: "Use send_mail." }))
  if (!result.ok) throw new Error(result.detail)
  const [queued] = store.getQueuedMessages(result.chatId ?? "")
  expect(queued.content.startsWith("Invoice due")).toBe(true)
  expect(queued.content).toContain("external Mail message data")
  expect(queued.content).toContain(`thread_id ${result.threadId}`)
  expect(queued.content).toContain(INBOX_REPORT_TOOL_NAME)
  expect(queued.content).toContain("Use send_mail.")
  expect(queued.autoContinue).toEqual({ scheduleId: "mcp-mail1-d1" })
})

test("a webhook delivery keeps its per-delivery schedule id and its webhook card", async () => {
  const { store, agent, chat, bus, inbox } = await createWebhookHarness()
  const result = await deliverInbound(
    store,
    agent,
    bus,
    inbox,
    delivery({ source: { kind: "webhook", hookId: "hook-12345678", hookName: "CI" }, sourceName: "CI", deliveryId: "d9" }, { mode: "inline", chatId: chat.id }),
  )
  if (!result.ok) throw new Error(result.detail)
  expect(store.getQueuedMessages(chat.id)[0].autoContinue).toEqual({ scheduleId: "webhook-hook-12345678-d9" })
  expect(store.getMessages(chat.id).map((entry) => entry.kind)).toEqual(["webhook_delivery"])
  expect(inbox.getThread(result.threadId)?.chatId).toBe(chat.id)
})

test("an mcp delivery leaves an inbound_delivery card", async () => {
  const { store, agent, chat, bus, inbox } = await createWebhookHarness()
  await deliverInbound(store, agent, bus, inbox, delivery({}, { mode: "inline", chatId: chat.id }))
  expect(store.getMessages(chat.id)).toMatchObject([{ kind: "inbound_delivery", sourceName: "Mail", deliveryId: "d1" }])
})

test("notify marks the thread needs_you, leaves a card and queues nothing", async () => {
  const { store, agent, chat, bus, inbox } = await createWebhookHarness()
  const result = await deliverInbound(store, agent, bus, inbox, delivery({}, { mode: "notify", chatId: chat.id }))
  if (!result.ok) throw new Error(result.detail)
  expect(inbox.getThread(result.threadId)).toMatchObject({ state: "needs_you", unread: true })
  expect(store.getQueuedMessages(chat.id)).toEqual([])
  expect(store.getMessages(chat.id)).toMatchObject([{ kind: "inbound_delivery", message: "Invoice due" }])
})

test("the inbound envelope is published on the bus under the source subject", async () => {
  const { store, agent, project, bus, inbox } = await createWebhookHarness()
  const seen: string[] = []
  bus.subscribe("kanna.mcp.>", (envelope) => seen.push(`${envelope.subject}|${envelope.idempotencyKey}|${envelope.direction}`))
  await deliverInbound(store, agent, bus, inbox, delivery({}, { projectId: project.id }))
  expect(seen).toEqual(["kanna.mcp.mail1.message|mcp:mail1:d1|inbound"])
})

test("a missing target fails before anything is stored", async () => {
  const { store, agent, bus, inbox } = await createWebhookHarness()
  const result = await deliverInbound(store, agent, bus, inbox, delivery({}, { mode: "inline", chatId: "gone" }))
  expect(result.ok).toBe(false)
  expect(inbox.snapshot().threads).toEqual([])
})
