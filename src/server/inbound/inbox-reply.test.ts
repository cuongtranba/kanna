import { expect, test } from "vite-plus/test"
import type { InboundHandler } from "../../shared/inbound/handler"
import { createWebhookHarness } from "../test-helpers/webhook-harness"
import { deliverInbound } from "./deliver-inbound"
import { instructInboxThread, replyToInboxThread } from "./inbox-reply"

const HANDLER: InboundHandler = {
  mode: "inline",
  template: "{{subject}}",
  replyHint: "Reply to {{from}} with send_mail.",
  pushEnabled: true,
  provider: "codex",
  model: "gpt-5.4",
}

async function threadWithChat() {
  const harness = await createWebhookHarness()
  const handler: InboundHandler = { ...HANDLER, chatId: harness.chat.id }
  const result = await deliverInbound(harness.store, harness.agent, harness.bus, harness.inbox, {
    source: { kind: "mcp", sourceId: "mail1", sourceName: "Mail", serverId: "s", serverName: "mail" },
    sourceName: "Mail",
    handler,
    deliveryId: "d1",
    body: { subject: "Invoice", from: "ada@example.com" },
    threadKey: "t",
    sender: "ada",
    at: 10,
  })
  if (!result.ok) throw new Error(result.detail)
  return { ...harness, handler, threadId: result.threadId }
}

test("a reply queues the rendered prompt under an incrementing schedule id and marks the thread replied", async () => {
  const { store, agent, inbox, chat, handler, threadId } = await threadWithChat()
  const first = await replyToInboxThread(store, agent, inbox, () => handler, threadId, "Thanks, paid.")
  const second = await replyToInboxThread(store, agent, inbox, () => handler, threadId, "Receipt attached.")
  expect(first).toEqual({ ok: true, chatId: chat.id })
  expect(second.ok).toBe(true)
  const queued = store.getQueuedMessages(chat.id).filter((message) => message.autoContinue?.scheduleId.startsWith("inbox-reply-"))
  expect(queued.map((message) => message.autoContinue?.scheduleId)).toEqual([`inbox-reply-${threadId}-1`, `inbox-reply-${threadId}-2`])
  expect(queued[0].content).toContain("Send exactly the reply text")
  expect(queued[0].content).toContain("Thanks, paid.")
  expect(queued[0].content).toContain("Reply to ada@example.com with send_mail.")
  expect(queued[0]).toMatchObject({ provider: "codex", model: "gpt-5.4" })
  expect(inbox.getThread(threadId)).toMatchObject({ state: "replied", replyCount: 2 })
})

test("an instruction marks the thread pending and asks the agent to report again", async () => {
  const { store, agent, inbox, chat, handler, threadId } = await threadWithChat()
  const result = await instructInboxThread(store, agent, inbox, () => handler, threadId, "Check the amount", () => 77)
  expect(result).toEqual({ ok: true, chatId: chat.id })
  const queued = store.getQueuedMessages(chat.id).at(-1)
  expect(queued?.autoContinue).toEqual({ scheduleId: `inbox-instruct-${threadId}-77` })
  expect(queued?.content).toContain("Check the amount")
  expect(queued?.content).toContain(`thread_id ${threadId}`)
  expect(inbox.getThread(threadId)?.pendingScheduleId).toBe(`inbox-instruct-${threadId}-77`)
})

test("a notify thread has no handler chat, so reply and instruct are refused", async () => {
  const { store, agent, inbox, bus, chat } = await createWebhookHarness()
  const result = await deliverInbound(store, agent, bus, inbox, {
    source: { kind: "mcp", sourceId: "mail1", sourceName: "Mail", serverId: "s", serverName: "mail" },
    sourceName: "Mail",
    handler: { mode: "notify", chatId: chat.id, template: "t", replyHint: "", pushEnabled: true },
    deliveryId: "d1",
    body: "x",
    threadKey: "t",
    sender: "ada",
    at: 10,
  })
  if (!result.ok) throw new Error(result.detail)
  const reply = await replyToInboxThread(store, agent, inbox, () => null, result.threadId, "hi")
  const instruct = await instructInboxThread(store, agent, inbox, () => null, result.threadId, "hi")
  expect(reply).toEqual({ ok: false, error: "This thread has no handler chat" })
  expect(instruct).toEqual({ ok: false, error: "This thread has no handler chat" })
  expect(store.getQueuedMessages(chat.id)).toEqual([])
})
