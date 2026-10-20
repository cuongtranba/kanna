import type { InboxRegistry } from "../inbox/inbox-registry"
import type { BusSink } from "../service-bus/service-bus"
import { createFileWebhookStore } from "./webhook-store.adapter"
import type { WebhookDeliveryAgent, WebhookDeliveryStore } from "./webhook-delivery"
import { WebhookRegistry } from "./webhook-registry"
import { WebhookService } from "./webhook-service"

export async function createWebhookService(
  dataDir: string,
  store: WebhookDeliveryStore,
  agent: WebhookDeliveryAgent,
  bus: BusSink,
  inbox: InboxRegistry,
  enabled: boolean,
): Promise<WebhookService> {
  const registry = new WebhookRegistry(createFileWebhookStore(dataDir))
  await registry.initialize()
  return new WebhookService(registry, store, agent, bus, inbox, enabled)
}
