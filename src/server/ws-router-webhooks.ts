import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { PROTOCOL_VERSION } from "../shared/types"
import type { WebhookInput, WebhookPatch } from "../shared/webhooks/types"
import { isWebhookMode } from "../shared/webhooks/validate"
import type { WebhookMutation, WebhookRegistry } from "./webhooks/webhook-registry"

function text(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function sanitizeInput(input: WebhookInput): WebhookInput {
  return {
    name: text(input.name) ?? "",
    mode: isWebhookMode(String(input.mode)) ? input.mode : "notify",
    template: text(input.template) ?? "",
    chatId: text(input.chatId),
    projectId: text(input.projectId),
  }
}

function sanitizePatch(patch: WebhookPatch): WebhookPatch {
  return {
    name: text(patch.name),
    template: text(patch.template),
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
    mode: patch.mode !== undefined && isWebhookMode(String(patch.mode)) ? patch.mode : undefined,
    chatId: patch.chatId === null ? null : text(patch.chatId),
    projectId: patch.projectId === null ? null : text(patch.projectId),
  }
}

function unwrap<T>(outcome: WebhookMutation<T>): T {
  if (!outcome.ok) throw new Error(outcome.errors.join("; "))
  return outcome.value
}

async function run(registry: WebhookRegistry, command: ClientCommand) {
  switch (command.type) {
    case "webhooks.create":
      return unwrap(await registry.create(sanitizeInput(command.input)))
    case "webhooks.update":
      return { hook: unwrap(await registry.update(command.id, sanitizePatch(command.patch))) }
    case "webhooks.rotateSecret":
      return unwrap(await registry.rotateSecret(command.id))
    case "webhooks.delete":
      return { ok: await registry.delete(command.id) }
    default:
      return null
  }
}

export async function handleWebhooksCommand(
  registry: WebhookRegistry | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (!command.type.startsWith("webhooks.")) return false
  if (!registry) throw new Error("Webhooks are not available on this server")
  const result = await run(registry, command)
  if (result === null) return false
  send({ v: PROTOCOL_VERSION, type: "ack", id, result })
  return true
}
