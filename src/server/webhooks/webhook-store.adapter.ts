import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import { isAgentProvider } from "../../shared/types"
import { isWebhookMode } from "../../shared/webhooks/validate"
import { createSecretJsonStore } from "../secret-json-store.adapter"
import type { StoredWebhook, WebhookStorePort } from "./webhook-registry"

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
  if (typeof template !== "string" || typeof mode !== "string" || !isWebhookMode(mode)) return null
  if (typeof enabled !== "boolean" || typeof createdAt !== "number" || typeof updatedAt !== "number") return null
  const kind = value.kind === undefined ? "generic" : value.kind
  if (kind !== "generic" && kind !== "slack") return null
  const slackBotToken = optionalString(value.slackBotToken)
  if (kind === "slack" && !slackBotToken) return null
  const chatId = optionalString(value.chatId)
  const projectId = optionalString(value.projectId)
  const provider = typeof value.provider === "string" && isAgentProvider(value.provider) ? value.provider : undefined
  const model = optionalString(value.model)
  const threadKeyPath = optionalString(value.threadKeyPath)
  const senderPath = optionalString(value.senderPath)
  const replyHint = optionalString(value.replyHint)
  const filter = optionalString(value.filter)
  const handling = value.handling === "task" ? value.handling : undefined
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
    ...(kind === "generic" && handling ? { handling } : {}),
    ...(chatId ? { chatId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(provider && model ? { provider, model } : {}),
    ...(threadKeyPath ? { threadKeyPath } : {}),
    ...(senderPath ? { senderPath } : {}),
    ...(replyHint ? { replyHint } : {}),
    ...(filter ? { filter } : {}),
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
