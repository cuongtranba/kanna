import type { JsonValue } from "../../shared/json"
import type { InboundHandler } from "../../shared/inbound/handler"
import {
  inboundUntrustedNotice,
  renderHandlerInstruction,
  renderInboundMessage,
  renderInboundPrompt,
} from "../../shared/inbound/template"
import { createBusEnvelope, inboundIdempotencyKey, inboundSourceId, type BusEnvelope, type InboundBusSource } from "../../shared/service-bus/envelope"
import { mcpMessageSubject, webhookDeliverySubject } from "../../shared/service-bus/subjects"
import type { AgentCoordinator } from "../agent-coordinator"
import { timestamped } from "../../shared/transcript-entry"
import type { EventStore } from "../event-store"
import type { InboxRegistry } from "../inbox/inbox-registry"
import type { BusSink } from "../service-bus/service-bus"

export type InboundDeliveryStore = Pick<EventStore, "getChat" | "getProject" | "createChat" | "appendMessage" | "renameChat">
export type InboundDeliveryAgent = Pick<AgentCoordinator, "enqueueMessage" | "maybeStartNextQueuedMessage" | "emitStateChange">

export type InboundSource = InboundBusSource

export interface InboundDelivery {
  source: InboundSource
  sourceName: string
  handler: InboundHandler
  deliveryId: string
  body: JsonValue
  threadKey: string
  sender: string
  at: number
}

export type InboundDeliveryResult = { ok: true; chatId?: string; threadId: string } | { ok: false; detail: string }

type ChatTarget = { ok: true; chatId: string } | { ok: false; detail: string }

export function inboundScheduleId(source: InboundSource, deliveryId: string): string {
  return source.kind === "webhook" ? `webhook-${source.hookId}-${deliveryId}` : `mcp-${source.sourceId}-${deliveryId}`
}

function noticeFor(delivery: InboundDelivery): string {
  return inboundUntrustedNotice(delivery.source.kind === "webhook" ? "webhook" : `${delivery.sourceName} message`)
}

function inboundEnvelope(delivery: InboundDelivery): BusEnvelope {
  const { source } = delivery
  const id = inboundSourceId(source)
  return createBusEnvelope({
    subject: source.kind === "webhook" ? webhookDeliverySubject(id) : mcpMessageSubject(id),
    ts: delivery.at,
    source,
    direction: "inbound",
    idempotencyKey: inboundIdempotencyKey(source.kind, id, delivery.deliveryId),
    payload: delivery.body,
  })
}

function checkTarget(store: InboundDeliveryStore, handler: InboundHandler): string | null {
  if (handler.mode === "spawn") return handler.projectId && store.getProject(handler.projectId) ? null : "target project not found"
  return handler.chatId && store.getChat(handler.chatId) ? null : "target chat not found"
}

async function resolveChat(
  store: InboundDeliveryStore,
  inbox: InboxRegistry,
  delivery: InboundDelivery,
  threadId: string,
  boundChatId: string | undefined,
): Promise<ChatTarget> {
  const { handler } = delivery
  if (handler.mode !== "spawn") return { ok: true, chatId: handler.chatId ?? "" }
  if (boundChatId && store.getChat(boundChatId)) return { ok: true, chatId: boundChatId }
  if (!handler.projectId) return { ok: false, detail: "target project not found" }
  const spawned = await store.createChat(handler.projectId)
  await store.renameChat(spawned.id, `${delivery.sourceName} · ${delivery.sender}`)
  await inbox.bindChat(threadId, spawned.id)
  return { ok: true, chatId: spawned.id }
}

async function appendCard(
  store: InboundDeliveryStore,
  agent: InboundDeliveryAgent,
  chatId: string,
  delivery: InboundDelivery,
  threadId: string,
): Promise<void> {
  const { source, handler } = delivery
  const message = handler.mode === "notify" ? renderInboundMessage(handler.template, delivery.body) : undefined
  const card =
    source.kind === "webhook"
      ? {
          kind: "webhook_delivery" as const,
          hookId: source.hookId,
          hookName: delivery.sourceName,
          mode: handler.mode,
          deliveryId: delivery.deliveryId,
          ...(message !== undefined ? { message } : {}),
        }
      : {
          kind: "inbound_delivery" as const,
          sourceKind: source.kind,
          sourceId: source.sourceId,
          sourceName: delivery.sourceName,
          mode: handler.mode,
          deliveryId: delivery.deliveryId,
          threadId,
          ...(message !== undefined ? { message } : {}),
        }
  await store.appendMessage(chatId, timestamped(card, delivery.at))
  agent.emitStateChange(chatId)
}

export async function queueHandlerTurn(
  agent: Pick<InboundDeliveryAgent, "enqueueMessage" | "maybeStartNextQueuedMessage">,
  chatId: string,
  handler: InboundHandler | null,
  prompt: string,
  scheduleId: string,
): Promise<void> {
  await agent.enqueueMessage(chatId, prompt, [], {
    autoContinue: { scheduleId },
    ...(handler?.provider && handler.model ? { provider: handler.provider, model: handler.model } : {}),
  })
  await agent.maybeStartNextQueuedMessage(chatId)
}

async function queuePrompt(
  agent: InboundDeliveryAgent,
  inbox: InboxRegistry,
  chatId: string,
  delivery: InboundDelivery,
  threadId: string,
): Promise<void> {
  const { handler } = delivery
  const scheduleId = inboundScheduleId(delivery.source, delivery.deliveryId)
  const prompt = [
    renderInboundPrompt(handler.template, delivery.body, noticeFor(delivery)),
    renderHandlerInstruction({
      threadId,
      sourceName: delivery.sourceName,
      replyHint: handler.replyHint,
      handling: handler.handling,
    }),
  ].join("\n\n")
  await inbox.markPending(threadId, scheduleId)
  await queueHandlerTurn(agent, chatId, handler, prompt, scheduleId)
}

export async function deliverInbound(
  store: InboundDeliveryStore,
  agent: InboundDeliveryAgent,
  bus: BusSink,
  inbox: InboxRegistry,
  delivery: InboundDelivery,
): Promise<InboundDeliveryResult> {
  const targetError = checkTarget(store, delivery.handler)
  if (targetError !== null) return { ok: false, detail: targetError }
  const envelope = inboundEnvelope(delivery)
  bus.publish(envelope)
  const thread = await inbox.ingestInbound(envelope, {
    threadKey: delivery.threadKey,
    sender: delivery.sender,
    sourceName: delivery.sourceName,
    deliveryId: delivery.deliveryId,
  })
  const target = await resolveChat(store, inbox, delivery, thread.id, thread.chatId)
  if (!target.ok) return target
  if (delivery.handler.mode === "inline") await inbox.bindChat(thread.id, target.chatId)
  await appendCard(store, agent, target.chatId, delivery, thread.id)
  if (delivery.handler.mode === "notify") {
    await inbox.escalate(thread.id, target.chatId)
    return { ok: true, chatId: target.chatId, threadId: thread.id }
  }
  await queuePrompt(agent, inbox, target.chatId, delivery, thread.id)
  return { ok: true, chatId: target.chatId, threadId: thread.id }
}
