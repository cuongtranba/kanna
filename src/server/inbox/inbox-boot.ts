import type { InboundHandler } from "../../shared/inbound/handler"
import { instructInboxThread, replyToInboxThread, type InboundHandlerResolver, type InboxReplyAgent, type InboxReplyStore } from "../inbound/inbox-reply"
import type { McpSourcesRuntime } from "../mcp-sources/mcp-sources-boot"
import type { ServiceBus } from "../service-bus/service-bus"
import type { PushManager } from "../push/push-manager"
import { webhookHandler } from "../webhooks/webhook-delivery"
import type { WebhookRegistry } from "../webhooks/webhook-registry"
import type { InboxActions } from "../ws-router-inbox"
import { createFileInboxLog } from "./inbox-log.adapter"
import { createInboxAutopilot, type AutopilotClock, type AutopilotSourceResolver, type InboxAutopilot } from "./inbox-autopilot"
import type { InboxOutbox, OutboxSourceResolver } from "./inbox-outbox"
import { InboxRegistry } from "./inbox-registry"
import { startInboxSnoozeWaker } from "./inbox-snooze-waker"

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

export const realAutopilotClock: AutopilotClock = {
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const handle = setTimeout(run, delayMs)
    handle.unref()
    return () => { clearTimeout(handle) }
  },
}

export function mcpAutopilotSourceResolver(
  mcpSources: Pick<McpSourcesRuntime, "sources">,
): AutopilotSourceResolver {
  return (thread) => {
    if (thread.sourceKind !== "mcp") return null
    const source = mcpSources.sources().find((candidate) => candidate.id === thread.sourceId)
    if (!source) return null
    return {
      id: source.id,
      hasReply: source.reply !== null,
      autonomy: source.autonomy,
      ...(source.handler.provider === undefined ? {} : { provider: source.handler.provider }),
    }
  }
}

export function wireInboxAutopilot(
  inbox: InboxRegistry,
  outbox: InboxOutbox,
  mcpSources: Pick<McpSourcesRuntime, "sources">,
  clock: AutopilotClock = realAutopilotClock,
): InboxAutopilot {
  const autopilot = createInboxAutopilot({ registry: inbox, outbox, resolveSource: mcpAutopilotSourceResolver(mcpSources), clock })
  inbox.onProposeSend((threadId, proposal) => autopilot.propose(threadId, proposal))
  return autopilot
}

export function startInboxSnooze(inbox: InboxRegistry, clock: AutopilotClock = realAutopilotClock): Promise<() => void> {
  return startInboxSnoozeWaker({ registry: inbox, clock })
}

export function createInboxReplyActions(
  store: InboxReplyStore,
  agent: InboxReplyAgent,
  inbox: InboxRegistry,
  resolveHandler: InboundHandlerResolver,
  outbox: InboxOutbox,
  autopilot: InboxAutopilot,
): { inboxActions: InboxActions } {
  return {
    inboxActions: {
      async reply(threadId, text) {
        if (outbox.hasReplyTarget(threadId)) {
          const sent = await outbox.send(threadId, text, "you")
          if (!sent.ok) return sent
          await autopilot.takeOver(threadId)
          return { ok: true, mode: "direct", outboundId: sent.outboundId }
        }
        const replied = await replyToInboxThread(store, agent, inbox, resolveHandler, threadId, text)
        return replied.ok ? { ok: true, mode: "agent", chatId: replied.chatId } : replied
      },
      instruct: (threadId, text, draft) => instructInboxThread(store, agent, inbox, resolveHandler, threadId, text, draft),
      retrySend: (threadId, outboundId, confirmDuplicate) => outbox.retry(threadId, outboundId, confirmDuplicate),
      approveProposal: (threadId, proposalId, text) => autopilot.approve(threadId, proposalId, text),
      rejectProposal: (threadId, proposalId) => autopilot.reject(threadId, proposalId),
      cancelProposal: (threadId, proposalId) => autopilot.cancel(threadId, proposalId),
    },
  }
}

export function wireInboxPush(
  inbox: InboxRegistry,
  pushManager: Pick<PushManager, "notifyInbox" | "notifyInboxProposal">,
  resolveHandler: InboundHandlerResolver,
  resolveSource: AutopilotSourceResolver,
): () => void {
  const stopNeedsYou = inbox.onNeedsYou((thread) => {
    const handler = resolveHandler(thread)
    if (handler?.pushEnabled === false) return
    void pushManager.notifyInbox(thread, handler?.pushPreview === true)
  })
  const stopProposals = inbox.onProposalOpened((thread, proposal) => {
    const handler = resolveHandler(thread)
    if (handler?.pushEnabled === false) return
    void pushManager.notifyInboxProposal(thread, proposal, {
      withPreview: handler?.pushPreview === true,
      withSendAction: resolveSource(thread)?.autonomy.sendFromNotification === true,
    })
  })
  return () => {
    stopNeedsYou()
    stopProposals()
  }
}
