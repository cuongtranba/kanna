import type { InboundHandler } from "../../shared/inbound/handler"
import { renderInstructPrompt, renderReplyPrompt } from "../../shared/inbound/reply-prompt"
import type { InboxThread } from "../../shared/inbox/types"
import type { InboxRegistry } from "../inbox/inbox-registry"
import type { InboundDeliveryAgent, InboundDeliveryStore } from "./deliver-inbound"

export type InboxReplyStore = Pick<InboundDeliveryStore, "getChat">
export type InboxReplyAgent = Pick<InboundDeliveryAgent, "enqueueMessage" | "maybeStartNextQueuedMessage">
export type InboundHandlerResolver = (thread: InboxThread) => InboundHandler | null

export type InboxReplyResult = { ok: true; chatId: string } | { ok: false; error: string }

interface ThreadTarget {
  thread: InboxThread
  chatId: string
  handler: InboundHandler | null
}

function resolveTarget(
  store: InboxReplyStore,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
  threadId: string,
): ThreadTarget | string {
  const thread = inbox.getThread(threadId)
  if (!thread) return `Unknown inbox thread ${threadId}`
  if (!thread.chatId) return "This thread has no handler chat"
  if (!store.getChat(thread.chatId)) return "The handler chat no longer exists"
  return { thread, chatId: thread.chatId, handler: resolveHandler(thread) }
}

function latestPayload(thread: InboxThread) {
  return thread.messages.at(-1)?.payload ?? null
}

async function queue(
  agent: InboxReplyAgent,
  target: ThreadTarget,
  prompt: string,
  scheduleId: string,
): Promise<void> {
  const { handler } = target
  await agent.enqueueMessage(target.chatId, prompt, [], {
    autoContinue: { scheduleId },
    ...(handler?.provider && handler.model ? { provider: handler.provider, model: handler.model } : {}),
  })
  await agent.maybeStartNextQueuedMessage(target.chatId)
}

export async function replyToInboxThread(
  store: InboxReplyStore,
  agent: InboxReplyAgent,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
  threadId: string,
  text: string,
): Promise<InboxReplyResult> {
  const target = resolveTarget(store, inbox, resolveHandler, threadId)
  if (typeof target === "string") return { ok: false, error: target }
  const scheduleId = `inbox-reply-${threadId}-${target.thread.replyCount + 1}`
  const prompt = renderReplyPrompt({
    sourceName: target.thread.sourceName,
    replyHint: target.handler?.replyHint ?? "",
    latestMessage: latestPayload(target.thread),
    text,
  })
  await queue(agent, target, prompt, scheduleId)
  await inbox.markReplied(threadId, target.chatId, scheduleId)
  return { ok: true, chatId: target.chatId }
}

export async function instructInboxThread(
  store: InboxReplyStore,
  agent: InboxReplyAgent,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
  threadId: string,
  text: string,
  now: () => number = Date.now,
): Promise<InboxReplyResult> {
  const target = resolveTarget(store, inbox, resolveHandler, threadId)
  if (typeof target === "string") return { ok: false, error: target }
  const scheduleId = `inbox-instruct-${threadId}-${now()}`
  const prompt = renderInstructPrompt({
    sourceName: target.thread.sourceName,
    replyHint: target.handler?.replyHint ?? "",
    threadId,
    latestMessage: latestPayload(target.thread),
    text,
  })
  await inbox.markPending(threadId, scheduleId)
  await queue(agent, target, prompt, scheduleId)
  return { ok: true, chatId: target.chatId }
}
