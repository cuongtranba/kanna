import type { AgentCoordinator } from "../agent-coordinator"
import { timestamped } from "../claude-message-normalizer"
import type { EventStore } from "../event-store"
import { renderWebhookMessage, renderWebhookPrompt, type WebhookBody } from "../../shared/webhooks/template"
import type { WebhookConfig } from "../../shared/webhooks/types"

export type WebhookDeliveryStore = Pick<EventStore, "getChat" | "getProject" | "createChat" | "appendMessage">
export type WebhookDeliveryAgent = Pick<AgentCoordinator, "enqueueMessage" | "maybeStartNextQueuedMessage" | "emitStateChange">

export type WebhookDeliveryResult = { ok: true; chatId: string } | { ok: false; detail: string }

export function webhookScheduleId(hookId: string, deliveryId: string): string {
  return `webhook-${hookId}-${deliveryId}`
}

async function appendCard(
  store: WebhookDeliveryStore,
  agent: WebhookDeliveryAgent,
  chatId: string,
  hook: WebhookConfig,
  deliveryId: string,
  message: string | undefined,
  at: number,
): Promise<void> {
  await store.appendMessage(chatId, timestamped({
    kind: "webhook_delivery",
    hookId: hook.id,
    hookName: hook.name,
    mode: hook.mode,
    deliveryId,
    ...(message !== undefined ? { message } : {}),
  }, at))
  agent.emitStateChange(chatId)
}

async function queuePrompt(
  agent: WebhookDeliveryAgent,
  chatId: string,
  hook: WebhookConfig,
  deliveryId: string,
  body: WebhookBody,
): Promise<void> {
  await agent.enqueueMessage(chatId, renderWebhookPrompt(hook.template, body), [], {
    autoContinue: { scheduleId: webhookScheduleId(hook.id, deliveryId) },
    ...(hook.provider && hook.model ? { provider: hook.provider, model: hook.model } : {}),
  })
  await agent.maybeStartNextQueuedMessage(chatId)
}

async function resolveTargetChat(
  store: WebhookDeliveryStore,
  hook: WebhookConfig,
): Promise<{ ok: true; chatId: string } | { ok: false; detail: string }> {
  if (hook.mode === "spawn") {
    if (!hook.projectId || !store.getProject(hook.projectId)) return { ok: false, detail: "target project not found" }
    const spawned = await store.createChat(hook.projectId)
    return { ok: true, chatId: spawned.id }
  }
  if (!hook.chatId || !store.getChat(hook.chatId)) return { ok: false, detail: "target chat not found" }
  return { ok: true, chatId: hook.chatId }
}

export async function deliverWebhook(
  store: WebhookDeliveryStore,
  agent: WebhookDeliveryAgent,
  hook: WebhookConfig,
  deliveryId: string,
  body: WebhookBody,
  at: number,
): Promise<WebhookDeliveryResult> {
  const target = await resolveTargetChat(store, hook)
  if (!target.ok) return target
  const message = hook.mode === "notify" ? renderWebhookMessage(hook.template, body) : undefined
  await appendCard(store, agent, target.chatId, hook, deliveryId, message, at)
  if (hook.mode !== "notify") await queuePrompt(agent, target.chatId, hook, deliveryId, body)
  return { ok: true, chatId: target.chatId }
}
