import type { McpSourcesRuntime } from "../mcp-sources/mcp-sources-boot"
import type { InboxRegistry } from "../inbox/inbox-registry"
import type { WebhookRegistry } from "../webhooks/webhook-registry"

export interface IntegrationChatSources {
  mcpSources: Pick<McpSourcesRuntime, "sources">
  webhooks: Pick<WebhookRegistry, "snapshot">
  inbox: Pick<InboxRegistry, "referencedChatIds">
}

export function createReferencedChatIds({ mcpSources, webhooks, inbox }: IntegrationChatSources): () => Set<string> {
  return () => {
    const chatIds = new Set<string>(inbox.referencedChatIds())
    for (const source of mcpSources.sources()) {
      if (source.handler.chatId !== undefined) chatIds.add(source.handler.chatId)
    }
    for (const hook of webhooks.snapshot().hooks) {
      if (hook.chatId !== undefined) chatIds.add(hook.chatId)
    }
    return chatIds
  }
}
