import { QuickResponseAdapter } from "./quick-response"
import { isJsonObject, type JsonValue } from "../shared/json"
import { isUntitledChat } from "../shared/types"

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
  },
  required: ["title"],
  additionalProperties: false,
} as const

function normalizeGeneratedTitle(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 80)
  if (!normalized || isUntitledChat(normalized)) return null
  return normalized
}

export function fallbackTitleFromMessage(messageContent: string): string | null {
  const normalized = messageContent.replace(/\s+/g, " ").trim()
  if (!normalized) return null
  if (normalized.length <= 35) return normalized
  return `${normalized.slice(0, 35)}...`
}

export interface GenerateChatTitleResult {
  title: string | null
  usedFallback: boolean
  failureMessage: string | null
}

export async function generateTitleForChat(
  messageContent: string,
  cwd: string,
  adapter = new QuickResponseAdapter()
): Promise<string | null> {
  const result = await generateTitleForChatDetailed(messageContent, cwd, adapter)
  return result.title
}

export async function generateTitleForChatDetailed(
  messageContent: string,
  cwd: string,
  adapter = new QuickResponseAdapter()
): Promise<GenerateChatTitleResult> {
  const result = await adapter.generateStructuredOrFallback<string | null>({
    cwd,
    task: "conversation title generation",
    prompt: `Generate a short, descriptive title (under 30 chars) for a conversation that starts with this message.\n\n${messageContent}`,
    schema: TITLE_SCHEMA,
    parse: (value) => {
      const output = isJsonObject(value) ? value : {}
      return normalizeGeneratedTitle(output.title)
    },
  }, () => fallbackTitleFromMessage(messageContent))

  return { title: result.value, usedFallback: result.usedFallback, failureMessage: result.failureMessage }
}
