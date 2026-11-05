import type { InboundHandler } from "../../shared/inbound/handler"
import { instructInboxThread, replyToInboxThread, type InboundHandlerResolver, type InboxReplyAgent, type InboxReplyStore } from "../inbound/inbox-reply"
import type { McpSourcesRuntime } from "../mcp-sources/mcp-sources-boot"
import type { ServiceBus } from "../service-bus/service-bus"
import type { PushManager } from "../push/push-manager"
import { webhookHandler } from "../webhooks/webhook-delivery"
import type { WebhookRegistry } from "../webhooks/webhook-registry"
import type { InboxActions } from "../ws-router-inbox"
import { createFileInboxLog } from "./inbox-log.adapter"
import type { InboxOutbox, OutboxSourceResolver } from "./inbox-outbox"
import { InboxRegistry } from "./inbox-registry"

export async function createInbox(dataDir: string, bus: ServiceBus): Promise<InboxRegistry> {
  const inbox = new InboxRegistry(createFileInboxLog(dataDir), bus)
  await inbox.initialize()
  return inbox
}

export function webhookHandlerResolver(webhooks: Pick<WebhookRegistry, "resolve">): InboundHandlerResolver {
  return (thread): InboundHandler | null => {
    if (thread.sourceKind !== "webhook") return null
    const hook = webhooks.resolve(thread.sourceId)
    return hook ? webhookHandler(hook) : null
  }
}

export function mcpSourceHandlerResolver(mcpSources: Pick<McpSourcesRuntime, "sources">): InboundHandlerResolver {
  return (thread): InboundHandler | null => {
    if (thread.sourceKind !== "mcp") return null
    return mcpSources.sources().find((source) => source.id === thread.sourceId)?.handler ?? null
  }
}

export function inboxHandlerResolver(
  webhooks: Pick<WebhookRegistry, "resolve">,
  mcpSources: Pick<McpSourcesRuntime, "sources">,
): InboundHandlerResolver {
  const fromWebhook = webhookHandlerResolver(webhooks)
  const fromMcp = mcpSourceHandlerResolver(mcpSources)
  return (thread) => fromWebhook(thread) ?? fromMcp(thread)
}

export function mcpOutboxSourceResolver(mcpSources: Pick<McpSourcesRuntime, "sources">): OutboxSourceResolver {
  return (thread) => {
    if (thread.sourceKind !== "mcp") return null
    const source = mcpSources.sources().find((candidate) => candidate.id === thread.sourceId)
    return source?.reply ? { id: source.id, reply: source.reply } : null
  }
}

export function createInboxReplyActions(
  store: InboxReplyStore,
  agent: InboxReplyAgent,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
  outbox: InboxOutbox,
): { inboxActions: InboxActions } {
  return {
    inboxActions: {
      async reply(threadId, text) {
        if (outbox.hasReplyTarget(threadId)) {
          const sent = await outbox.send(threadId, text, "you")
          return sent.ok ? { ok: true, mode: "direct", outboundId: sent.outboundId } : sent
        }
        const replied = await replyToInboxThread(store, agent, inbox, resolveHandler, threadId, text)
        return replied.ok ? { ok: true, mode: "agent", chatId: replied.chatId } : replied
      },
      instruct: (threadId, text, draft) => instructInboxThread(store, agent, inbox, resolveHandler, threadId, text, draft),
      retrySend: (threadId, outboundId, confirmDuplicate) => outbox.retry(threadId, outboundId, confirmDuplicate),
    },
  }
}

export function wireInboxPush(inbox: InboxRegistry, pushManager: Pick<PushManager, "notifyInbox">, resolveHandler: InboundHandlerResolver): () => void {
  return inbox.onNeedsYou((thread) => {
    if (resolveHandler(thread)?.pushEnabled === false) return
    void pushManager.notifyInbox(thread)
  })
}
