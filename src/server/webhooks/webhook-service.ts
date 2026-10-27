import type { InboxRegistry } from "../inbox/inbox-registry"
import type { BusSink } from "../service-bus/service-bus"
import type { JsonValue } from "../../shared/json"
import {
  deliverWebhook,
  type WebhookDeliveryAgent,
  type WebhookDeliveryResult,
  type WebhookDeliveryStore,
} from "./webhook-delivery"
import type { StoredWebhook, WebhookRegistry } from "./webhook-registry"
import type { SlackService } from "./slack/slack-service"

export class WebhookService {
  constructor(
    readonly registry: WebhookRegistry,
    private readonly store: WebhookDeliveryStore,
    private readonly agent: WebhookDeliveryAgent,
    private readonly bus: BusSink,
    private readonly inbox: InboxRegistry,
    readonly slack: SlackService,
    readonly enabled: boolean,
    readonly now: () => number = Date.now,
  ) {}

  deliver(hook: StoredWebhook, deliveryId: string, body: JsonValue): Promise<WebhookDeliveryResult> {
    return deliverWebhook(this.store, this.agent, this.bus, this.inbox, hook, deliveryId, body, this.now())
  }
}
