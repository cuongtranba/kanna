import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import { isWebhookMode } from "../../shared/webhooks/validate"
import type { StoredWebhook, WebhookStorePort } from "./webhook-registry"

const FILE_NAME = "webhooks.json"
const FILE_MODE = 0o600

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseStoredWebhook(value: JsonValue): StoredWebhook | null {
  if (!isJsonObject(value)) return null
  const { id, name, secret, template, mode, enabled, createdAt, updatedAt } = value
  if (typeof id !== "string" || typeof name !== "string" || typeof secret !== "string") return null
  if (typeof template !== "string" || typeof mode !== "string" || !isWebhookMode(mode)) return null
  if (typeof enabled !== "boolean" || typeof createdAt !== "number" || typeof updatedAt !== "number") return null
  const chatId = optionalString(value.chatId)
  const projectId = optionalString(value.projectId)
  return {
    id,
    name,
    secret,
    template,
    mode,
    enabled,
    createdAt,
    updatedAt,
    ...(chatId ? { chatId } : {}),
    ...(projectId ? { projectId } : {}),
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
  const path = join(dataDir, FILE_NAME)
  const tempPath = `${path}.tmp`
  return {
    async load() {
      try {
        return parseStoredWebhooks(await readFile(path, "utf8"))
      } catch {
        return []
      }
    },
    async save(hooks) {
      await mkdir(dataDir, { recursive: true })
      await writeFile(tempPath, JSON.stringify({ hooks }, null, 2), { mode: FILE_MODE })
      await chmod(tempPath, FILE_MODE)
      await rename(tempPath, path)
    },
  }
}
