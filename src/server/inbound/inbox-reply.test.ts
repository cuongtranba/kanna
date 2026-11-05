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

test("an instruction asks the agent for a draft, fences instruction and draft apart and marks the thread pending", async () => {
  const { store, agent, inbox, chat, handler, threadId } = await threadWithChat()
  const result = await instructInboxThread(store, agent, inbox, () => handler, threadId, "Make it shorter", "Dear Ada, thank you very much.", () => 77)
  expect(result).toEqual({ ok: true, chatId: chat.id })
  const queued = store.getQueuedMessages(chat.id).at(-1)
  expect(queued?.autoContinue).toEqual({ scheduleId: `inbox-instruct-${threadId}-77` })
  expect(queued?.content).toContain("```text\nMake it shorter\n```")
  expect(queued?.content).toContain("```text\nDear Ada, thank you very much.\n```")
  expect(queued?.content).toContain("NEVER send anything to the sender")
  expect(queued?.content).toContain(`thread_id ${threadId}`)
  expect(queued?.content).toContain("draft_reply")
  expect(inbox.getThread(threadId)?.pendingScheduleId).toBe(`inbox-instruct-${threadId}-77`)
})

test("the draft the agent reports after an instruction becomes an ask draft carrying that instruction", async () => {
  const { store, agent, inbox, chat, handler, threadId } = await threadWithChat()
  await instructInboxThread(store, agent, inbox, () => handler, threadId, "Make it shorter", undefined, () => 77)
  await inbox.report(threadId, chat.id, "needs_you", "Rewritten", "Thanks, paid.")
  expect(inbox.getThread(threadId)?.drafts).toMatchObject([{ text: "Thanks, paid.", origin: "ask", instruction: "Make it shorter" }])
})

test("an archived thread cannot be asked for a draft", async () => {
  const { store, agent, inbox, chat, handler, threadId } = await threadWithChat()
  await inbox.archive(threadId)
  const queuedBefore = store.getQueuedMessages(chat.id).length
  const result = await instructInboxThread(store, agent, inbox, () => handler, threadId, "Make it shorter")
  expect(result).toEqual({ ok: false, error: "This thread is archived" })
  expect(store.getQueuedMessages(chat.id)).toHaveLength(queuedBefore)
  expect(inbox.getThread(threadId)?.pendingScheduleId).toBeUndefined()
})

test("on the agent path a notify thread has no handler chat, so reply and ask are refused", async () => {
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
