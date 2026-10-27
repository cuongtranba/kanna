import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import { isAgentProvider } from "../../shared/types"
import { isInboundHandlerMode } from "../../shared/inbound/handler"
import { createSecretJsonStore } from "../secret-json-store.adapter"
import { optionalHookFields, type StoredWebhook, type WebhookStorePort } from "./webhook-registry"

const FILE_NAME = "webhooks.json"

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseSlackIds(value: JsonValue | undefined): string[] {
  if (value === undefined || !isJsonObject(value) || !isJsonArray(value.allowedUserIds)) return []
  return value.allowedUserIds.filter((id): id is string => typeof id === "string" && id.length > 0)
}

function parseStoredWebhook(value: JsonValue): StoredWebhook | null {
  if (!isJsonObject(value)) return null
  const { id, name, secret, template, mode, enabled, createdAt, updatedAt } = value
  if (typeof id !== "string" || typeof name !== "string" || typeof secret !== "string") return null
  if (typeof template !== "string" || typeof mode !== "string" || !isInboundHandlerMode(mode)) return null
  if (typeof enabled !== "boolean" || typeof createdAt !== "number" || typeof updatedAt !== "number") return null
  const kind = value.kind === undefined ? "generic" : value.kind
  if (kind !== "generic" && kind !== "slack") return null
  const slackBotToken = optionalString(value.slackBotToken)
  if (kind === "slack" && !slackBotToken) return null
  const optional = optionalHookFields({
    kind,
    handling: value.handling === "task" ? value.handling : undefined,
    chatId: optionalString(value.chatId),
    projectId: optionalString(value.projectId),
    provider: typeof value.provider === "string" && isAgentProvider(value.provider) ? value.provider : undefined,
    model: optionalString(value.model),
    threadKeyPath: optionalString(value.threadKeyPath),
    senderPath: optionalString(value.senderPath),
    replyHint: optionalString(value.replyHint),
    filter: optionalString(value.filter),
  })
  return {
    id,
    name,
    secret,
    template,
    mode,
    enabled,
    createdAt,
    updatedAt,
    kind,
    ...(kind === "slack" && slackBotToken
      ? { slack: { allowedUserIds: parseSlackIds(value.slack) }, slackBotToken }
      : {}),
    ...optional,
  }
}

export function parseStoredWebhooks(text: string): StoredWebhook[] {
  const parsed = safeJsonParse(text)
  if (parsed === null || !isJsonObject(parsed) || !isJsonArray(parsed.hooks)) return []
  const hooks: StoredWebhook[] = []
  for (const entry of parsed.hooks) {
    const hook = parseStoredWebhook(entry)
    if (hook) hooks.push(hook)
  }
  return hooks
}

export function createFileWebhookStore(dataDir: string): WebhookStorePort {
  return createSecretJsonStore(dataDir, FILE_NAME, "hooks", parseStoredWebhooks)
}
