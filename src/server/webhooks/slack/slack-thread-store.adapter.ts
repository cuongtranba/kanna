import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../../shared/json"
import type { SlackThreadBinding, SlackThreadStorePort } from "./slack-threads"

const FILE_NAME = "slack-threads.json"
const FILE_MODE = 0o600

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
  const path = join(dataDir, FILE_NAME)
  const tempPath = `${path}.tmp`
  return {
    async load() {
      try {
        return parseSlackThreads(await readFile(path, "utf8"))
      } catch {
        return []
      }
    },
    async save(bindings) {
      await mkdir(dataDir, { recursive: true })
      await writeFile(tempPath, JSON.stringify({ threads: bindings }, null, 2), { mode: FILE_MODE })
      await chmod(tempPath, FILE_MODE)
      await rename(tempPath, path)
    },
  }
}
