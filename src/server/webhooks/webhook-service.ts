import type { InboxRegistry } from "../inbox/inbox-registry"
import type { BusSink } from "../service-bus/service-bus"
import type { WebhookBody } from "../../shared/webhooks/template"
import {
  deliverWebhook,
  type WebhookDeliveryAgent,
  type WebhookDeliveryResult,
  type WebhookDeliveryStore,
} from "./webhook-delivery"
import type { StoredWebhook, WebhookRegistry } from "./webhook-registry"

export class WebhookService {
  constructor(
    readonly registry: WebhookRegistry,
    private readonly store: WebhookDeliveryStore,
    private readonly agent: WebhookDeliveryAgent,
    private readonly bus: BusSink,
    private readonly inbox: InboxRegistry,
    readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  deliver(hook: StoredWebhook, deliveryId: string, body: WebhookBody): Promise<WebhookDeliveryResult> {
    return deliverWebhook(this.store, this.agent, this.bus, this.inbox, hook, deliveryId, body, this.now())
  }

  clock(): number {
    return this.now()
  }
}
