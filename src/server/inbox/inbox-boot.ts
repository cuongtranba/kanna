import type { InboundHandler } from "../../shared/inbound/handler"
import { instructInboxThread, replyToInboxThread, type InboundHandlerResolver, type InboxReplyAgent, type InboxReplyStore } from "../inbound/inbox-reply"
import type { ServiceBus } from "../service-bus/service-bus"
import { webhookHandler } from "../webhooks/webhook-delivery"
import type { WebhookRegistry } from "../webhooks/webhook-registry"
import type { InboxReplyAction } from "../ws-router-inbox"
import { createFileInboxLog } from "./inbox-log.adapter"
import { InboxRegistry } from "./inbox-registry"

export async function createInbox(dataDir: string, bus: ServiceBus): Promise<InboxRegistry> {
  const inbox = new InboxRegistry(createFileInboxLog(dataDir), bus)
  await inbox.initialize()
  return inbox
}

export function webhookHandlerResolver(webhooks: WebhookRegistry): InboundHandlerResolver {
  return (thread): InboundHandler | null => {
    if (thread.sourceKind !== "webhook") return null
    const hook = webhooks.resolve(thread.sourceId)
    return hook ? webhookHandler(hook) : null
  }
}

export function createInboxReplyActions(
  store: InboxReplyStore,
  agent: InboxReplyAgent,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
): { inboxReply: InboxReplyAction; inboxInstruct: InboxReplyAction } {
  return {
    inboxReply: (threadId, text) => replyToInboxThread(store, agent, inbox, resolveHandler, threadId, text),
    inboxInstruct: (threadId, text) => instructInboxThread(store, agent, inbox, resolveHandler, threadId, text),
  }
}
