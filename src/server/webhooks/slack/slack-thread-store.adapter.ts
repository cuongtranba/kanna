import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../../shared/json"
import { createSecretJsonStore } from "../../secret-json-store.adapter"
import type { SlackThreadBinding, SlackThreadStorePort } from "./slack-threads"

const FILE_NAME = "slack-threads.json"

function parseBinding(value: JsonValue): SlackThreadBinding | null {
  if (!isJsonObject(value)) return null
  const { key, hookId, teamId, channel, threadTs, chatId, lastSeenTs, mentionTs, updatedAt, repliedScheduleId } = value
  if (typeof key !== "string" || typeof hookId !== "string" || typeof teamId !== "string") return null
  if (typeof channel !== "string" || typeof threadTs !== "string" || typeof chatId !== "string") return null
  if (typeof lastSeenTs !== "string" || typeof mentionTs !== "string" || typeof updatedAt !== "number") return null
  return {
    key,
    hookId,
    teamId,
    channel,
    threadTs,
    chatId,
    lastSeenTs,
    mentionTs,
    updatedAt,
    ...(typeof repliedScheduleId === "string" ? { repliedScheduleId } : {}),
  }
}

export function parseSlackThreads(text: string): SlackThreadBinding[] {
  const parsed = safeJsonParse(text)
  if (parsed === null || !isJsonObject(parsed) || !isJsonArray(parsed.threads)) return []
  const bindings: SlackThreadBinding[] = []
  for (const entry of parsed.threads) {
    const binding = parseBinding(entry)
    if (binding) bindings.push(binding)
  }
  return bindings
}

export function createFileSlackThreadStore(dataDir: string): SlackThreadStorePort {
  return createSecretJsonStore(dataDir, FILE_NAME, "threads", parseSlackThreads)
}
