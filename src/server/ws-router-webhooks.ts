import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { ProviderCatalogEntry } from "../shared/provider-model-types"
import { isAgentProvider } from "../shared/types"
import { ackResult } from "./ws-router-ack"
import type { WebhookInput, WebhookPatch } from "../shared/webhooks/types"
import { isInboundHandling, type InboundHandling } from "../shared/inbound/handler"
import { isWebhookMode, mergeWebhookModel, validateWebhookModel } from "../shared/webhooks/validate"
import type { WebhookMutation, WebhookRegistry } from "./webhooks/webhook-registry"

function text(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function provider(value: string | null | undefined) {
  return typeof value === "string" && isAgentProvider(value) ? value : undefined
}

function handling(value: string | null | undefined): InboundHandling | undefined {
  return typeof value === "string" && isInboundHandling(value) ? value : undefined
}

function sanitizeInput(input: WebhookInput): WebhookInput {
  return {
    name: text(input.name) ?? "",
    mode: isWebhookMode(String(input.mode)) ? input.mode : "notify",
    handling: handling(input.handling),
    template: text(input.template) ?? "",
    chatId: text(input.chatId),
    projectId: text(input.projectId),
    provider: provider(input.provider),
    model: text(input.model)?.trim() || undefined,
    threadKeyPath: text(input.threadKeyPath),
    senderPath: text(input.senderPath),
    replyHint: text(input.replyHint),
    filter: text(input.filter),
  }
}

function clearableText(value: string | null | undefined): string | null | undefined {
  return value === null ? null : text(value)
}

function sanitizePatch(patch: WebhookPatch): WebhookPatch {
  return {
    name: text(patch.name),
    template: text(patch.template),
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    mode: patch.mode !== undefined && isWebhookMode(String(patch.mode)) ? patch.mode : undefined,
    handling: patch.handling === null ? null : handling(patch.handling),
    chatId: patch.chatId === null ? null : text(patch.chatId),
    projectId: patch.projectId === null ? null : text(patch.projectId),
    provider: patch.provider === null ? null : provider(patch.provider),
    model: patch.model === null ? null : text(patch.model)?.trim() || undefined,
    threadKeyPath: clearableText(patch.threadKeyPath),
    senderPath: clearableText(patch.senderPath),
    replyHint: clearableText(patch.replyHint),
    filter: clearableText(patch.filter),
  }
}

function unwrap<T>(outcome: WebhookMutation<T>): T {
  if (!outcome.ok) throw new Error(outcome.errors.join("; "))
  return outcome.value
}

function requireValidModel(errors: string[]) {
  if (errors.length > 0) throw new Error(errors.join("; "))
}

async function run(
  registry: WebhookRegistry,
  command: ClientCommand,
  id: string,
  providerCatalog: () => readonly ProviderCatalogEntry[],
): Promise<ServerEnvelope | null> {
  switch (command.type) {
    case "webhooks.create": {
      const input = sanitizeInput(command.input)
      requireValidModel(validateWebhookModel(input, providerCatalog()))
      return ackResult(id, command, unwrap(await registry.create(input)))
    }
    case "webhooks.update": {
      const patch = sanitizePatch(command.patch)
      const existing = registry.resolve(command.id)
      if (existing) requireValidModel(validateWebhookModel(mergeWebhookModel(existing, patch), providerCatalog()))
      return ackResult(id, command, { hook: unwrap(await registry.update(command.id, patch)) })
    }
    case "webhooks.rotateSecret":
      return ackResult(id, command, unwrap(await registry.rotateSecret(command.id)))
    case "webhooks.delete":
      return ackResult(id, command, { ok: await registry.delete(command.id) })
    default:
      return null
  }
}

export async function handleWebhooksCommand(
  registry: WebhookRegistry | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
  providerCatalog: () => readonly ProviderCatalogEntry[],
): Promise<boolean> {
  if (!command.type.startsWith("webhooks.")) return false
  if (!registry) throw new Error("Webhooks are not available on this server")
  const envelope = await run(registry, command, id, providerCatalog)
  if (envelope === null) return false
  send(envelope)
  return true
}
