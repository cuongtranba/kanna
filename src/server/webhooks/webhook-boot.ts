import type { InboxRegistry } from "../inbox/inbox-registry"
import type { ServiceBus } from "../service-bus/service-bus"
import { createFileWebhookStore } from "./webhook-store.adapter"
import type { WebhookDeliveryAgent, WebhookDeliveryStore } from "./webhook-delivery"
import { WebhookRegistry } from "./webhook-registry"
import { WebhookService } from "./webhook-service"
import { createSlackApi } from "./slack/slack-api.adapter"
import { SlackService, type SlackStore } from "./slack/slack-service"
import { createFileSlackThreadStore } from "./slack/slack-thread-store.adapter"
import { SlackThreadRegistry } from "./slack/slack-threads"

export async function createWebhookService(
  dataDir: string,
  store: WebhookDeliveryStore & SlackStore,
  agent: WebhookDeliveryAgent,
  bus: ServiceBus,
  inbox: InboxRegistry,
  enabled: boolean,
): Promise<WebhookService> {
  const registry = new WebhookRegistry(createFileWebhookStore(dataDir))
  await registry.initialize()
  const threads = new SlackThreadRegistry(createFileSlackThreadStore(dataDir))
  const slack = new SlackService(registry, store, agent, bus, threads, createSlackApi())
  await slack.start()
  return new WebhookService(registry, store, agent, bus, inbox, slack, enabled)
}
