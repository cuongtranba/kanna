import type { InboundHandler } from "../../shared/inbound/handler"
import { resolvePath, stringifyValue } from "../../shared/inbound/template"
import type { WebhookConfig } from "../../shared/webhooks/types"
import type { WebhookBody } from "../../shared/webhooks/template"
import type { InboxRegistry } from "../inbox/inbox-registry"
import {
  deliverInbound,
  inboundScheduleId,
  type InboundDeliveryAgent,
  type InboundDeliveryStore,
} from "../inbound/deliver-inbound"
import type { BusSink } from "../service-bus/service-bus"

export type WebhookDeliveryStore = InboundDeliveryStore
export type WebhookDeliveryAgent = InboundDeliveryAgent

export type WebhookDeliveryResult = { ok: true; chatId: string } | { ok: false; detail: string }

export function webhookScheduleId(hookId: string, deliveryId: string): string {
  return inboundScheduleId({ kind: "webhook", hookId, hookName: "" }, deliveryId)
}

export function webhookHandler(hook: WebhookConfig): InboundHandler {
  return {
    mode: hook.mode,
    template: hook.template,
    replyHint: hook.replyHint ?? "",
    pushEnabled: true,
    ...(hook.chatId ? { chatId: hook.chatId } : {}),
    ...(hook.projectId ? { projectId: hook.projectId } : {}),
    ...(hook.provider && hook.model ? { provider: hook.provider, model: hook.model } : {}),
  }
}

function pathValue(body: WebhookBody, path: string | undefined): string | null {
  if (!path) return null
  const text = stringifyValue(resolvePath(body, path)).trim()
  return text.length > 0 ? text : null
}

export async function deliverWebhook(
  store: WebhookDeliveryStore,
  agent: WebhookDeliveryAgent,
  bus: BusSink,
  inbox: InboxRegistry,
  hook: WebhookConfig,
  deliveryId: string,
  body: WebhookBody,
  at: number,
): Promise<WebhookDeliveryResult> {
  const result = await deliverInbound(store, agent, bus, inbox, {
    source: { kind: "webhook", hookId: hook.id, hookName: hook.name },
    sourceName: hook.name,
    handler: webhookHandler(hook),
    deliveryId,
    body,
    threadKey: pathValue(body, hook.threadKeyPath) ?? deliveryId,
    sender: pathValue(body, hook.senderPath) ?? hook.name,
    at,
  })
  if (!result.ok) return result
  return { ok: true, chatId: result.chatId ?? "" }
}
