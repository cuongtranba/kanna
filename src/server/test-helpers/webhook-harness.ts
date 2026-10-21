import { EventStore } from "../event-store"
import { InMemoryStorageBackend } from "../storage/in-memory-storage"
import { InboxRegistry } from "../inbox/inbox-registry"
import { createInMemoryServiceBus } from "../service-bus/in-memory-service-bus"
import { createMemoryInboxLog } from "./inbox-harness"
import { WebhookRegistry, type StoredWebhook, type WebhookStorePort } from "../webhooks/webhook-registry"
import { WebhookService } from "../webhooks/webhook-service"
import type { WebhookDeliveryAgent } from "../webhooks/webhook-delivery"
import { createBusTap } from "../service-bus/event-store-tap"
import { SlackService } from "../webhooks/slack/slack-service"
import { SlackThreadRegistry } from "../webhooks/slack/slack-threads"
import { createFakeSlackApi, createMemorySlackThreadStore } from "./slack-harness"

export function createMemoryWebhookStore(): WebhookStorePort & { saved: StoredWebhook[] } {
  const port = {
    saved: [] as StoredWebhook[],
    async load() {
      return port.saved
    },
    async save(hooks: readonly StoredWebhook[]) {
      port.saved = [...hooks]
    },
  }
  return port
}

export async function createWebhookHarness(options: { enabled?: boolean; now?: () => number; tapStore?: boolean } = {}) {
  const store = new EventStore("/virtual-webhooks", new InMemoryStorageBackend())
  await store.initialize()
  const project = await store.openProject("/tmp/webhook-project", "Webhook Project")
  const chat = await store.createChat(project.id)
  const startedChats: string[] = []
  const agent: WebhookDeliveryAgent = {
    enqueueMessage: async (chatId, content, attachments, sendOptions) =>
      store.enqueueMessage(chatId, {
        content,
        attachments,
        autoContinue: sendOptions?.autoContinue,
        provider: sendOptions?.provider,
        model: sendOptions?.model,
      }),
    maybeStartNextQueuedMessage: async (chatId) => {
      startedChats.push(chatId)
      return false
    },
    emitStateChange: () => {},
  }
  const bus = createInMemoryServiceBus()
  if (options.tapStore) store.tap = createBusTap(bus, (chatId) => store.getChat(chatId)?.projectId, options.now ?? Date.now)
  const inbox = new InboxRegistry(createMemoryInboxLog(), bus, options.now)
  await inbox.initialize()
  const registry = new WebhookRegistry(createMemoryWebhookStore(), options.now)
  const slackApi = createFakeSlackApi()
  const threadStore = createMemorySlackThreadStore()
  const slack = new SlackService(registry, store, agent, bus, new SlackThreadRegistry(threadStore, options.now), slackApi, options.now)
  await slack.start()
  const service = new WebhookService(registry, store, agent, bus, inbox, slack, options.enabled ?? true, options.now)
  return { store, project, chat, agent, registry, service, startedChats, bus, inbox, slack, slackApi, threadStore }
}
