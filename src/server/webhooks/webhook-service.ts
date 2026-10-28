import type { InboxRegistry } from "../inbox/inbox-registry"
import type { BusSink } from "../service-bus/service-bus"
import type { JsonValue } from "../../shared/json"
import { verifyWebhookRequest } from "./webhook-auth"
import {
  deliverWebhook,
  type WebhookDeliveryAgent,
  type WebhookDeliveryStore,
} from "./webhook-delivery"
import type { StoredWebhook, WebhookRegistry } from "./webhook-registry"
import { admissionResponse, jsonReject } from "./webhook-response"
import type { SlackService } from "./slack/slack-service"

const MAX_DELIVERY_ID_CHARS = 128
const DELIVERY_ID_HEADERS = ["x-github-delivery", "idempotency-key", "x-request-id"]

function pickDeliveryId(headers: Headers): string {
  for (const name of DELIVERY_ID_HEADERS) {
    const value = headers.get(name)?.trim()
    if (value) return value.slice(0, MAX_DELIVERY_ID_CHARS)
  }
  return crypto.randomUUID()
}

function parseBody(text: string): JsonValue {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export class WebhookService {
  constructor(
    readonly registry: WebhookRegistry,
    private readonly store: WebhookDeliveryStore,
    private readonly agent: WebhookDeliveryAgent,
    private readonly bus: BusSink,
    private readonly inbox: InboxRegistry,
    private readonly slack: SlackService,
    readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  async handle(hook: StoredWebhook, headers: Headers, raw: Uint8Array): Promise<Response> {
    if (hook.kind === "slack") return this.slack.handleRequest(hook, headers, raw)
    if (verifyWebhookRequest(hook.secret, headers, raw) !== "ok") return jsonReject(401, "unauthorized")

    const body = parseBody(new TextDecoder().decode(raw))
    const verdict = this.registry.matchFilter(hook.id, { body, headers })
    if (!verdict.matched) {
      this.recordOutcome(hook, true, 200, `filtered: ${verdict.reason}`, true)
      return Response.json({ ok: true, filtered: true })
    }

    const deliveryId = pickDeliveryId(headers)
    const refusal = admissionResponse(this.registry.admit(hook.id, deliveryId))
    if (refusal) return refusal
    return this.deliver(hook, deliveryId, body)
  }

  private recordOutcome(hook: StoredWebhook, ok: boolean, status: number, detail: string, filtered = false): void {
    this.registry.recordDelivery(hook.id, { at: this.now(), ok, status, detail, ...(filtered ? { filtered } : {}) })
  }

  private async deliver(hook: StoredWebhook, deliveryId: string, body: JsonValue): Promise<Response> {
    try {
      const result = await deliverWebhook(this.store, this.agent, this.bus, this.inbox, hook, deliveryId, body, this.now())
      if (!result.ok) {
        this.registry.releaseDelivery(hook.id, deliveryId)
        this.recordOutcome(hook, false, 409, result.detail)
        return jsonReject(409, result.detail)
      }
      this.recordOutcome(hook, true, 202, hook.mode)
      return Response.json({ ok: true, deliveryId, chatId: result.chatId }, { status: 202 })
    } catch {
      this.registry.releaseDelivery(hook.id, deliveryId)
      this.recordOutcome(hook, false, 500, "delivery failed")
      return jsonReject(500, "delivery failed")
    }
  }
}
