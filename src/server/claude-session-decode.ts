import { isJsonArray, isJsonObject, objectField, stringField } from "../shared/json"
import type { JsonArray, JsonObject, JsonValue } from "../shared/json"
import type {
  ClaudeSessionAssistantBlock,
  ClaudeSessionRecord,
  ClaudeSessionRecordBase,
  ClaudeSessionUserBlock,
} from "./claude-session-types"

const OTHER_BLOCK: { type: "other" } = { type: "other" }

function toolResultContent(value: JsonValue | undefined): string | JsonObject | JsonArray | undefined {
  if (typeof value === "string") return value
  if (value !== undefined && (isJsonObject(value) || isJsonArray(value))) return value
  return undefined
}

function decodeUserBlock(block: JsonValue): ClaudeSessionUserBlock {
  if (!isJsonObject(block)) return OTHER_BLOCK
  if (block.type === "text") {
    const text = stringField(block, "text")
    return text === undefined ? OTHER_BLOCK : { type: "text", text }
  }
  if (block.type === "tool_result") {
    const toolUseId = stringField(block, "tool_use_id")
    if (toolUseId === undefined) return OTHER_BLOCK
    return {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: toolResultContent(block.content),
      is_error: block.is_error === true,
    }
  }
  return OTHER_BLOCK
}

function decodeAssistantBlock(block: JsonValue): ClaudeSessionAssistantBlock {
  if (!isJsonObject(block)) return OTHER_BLOCK
  if (block.type === "text") {
    const text = stringField(block, "text")
    return text === undefined ? OTHER_BLOCK : { type: "text", text }
  }
  if (block.type === "tool_use") {
    const id = stringField(block, "id")
    const name = stringField(block, "name")
    if (id === undefined || name === undefined) return OTHER_BLOCK
    return { type: "tool_use", id, name, input: objectField(block, "input") ?? {} }
  }
  return OTHER_BLOCK
}

function decodeConversationRecord(source: JsonObject, base: ClaudeSessionRecordBase): ClaudeSessionRecord {
  const message = objectField(source, "message")
  if (message === null) return { ...base, type: "other" }
  const content = message.content
  if (source.type === "user") {
    if (typeof content === "string") return { ...base, type: "user", content }
    if (content === undefined || !isJsonArray(content)) return { ...base, type: "other" }
    const hasToolUseResult = Boolean(source.toolUseResult)
    return {
      ...base,
      type: "user",
      content: content.map(decodeUserBlock),
      debugRaw: hasToolUseResult ? JSON.stringify(source) : undefined,
    }
  }
  if (content === undefined || !isJsonArray(content)) return { ...base, type: "other" }
  return {
    ...base,
    type: "assistant",
    messageId: stringField(message, "id"),
    content: content.map(decodeAssistantBlock),
  }
}

export function decodeClaudeSessionRecord(source: JsonValue): ClaudeSessionRecord | null {
  if (!isJsonObject(source) || typeof source.type !== "string") return null
  const base: ClaudeSessionRecordBase = {
    uuid: stringField(source, "uuid"),
    sessionId: stringField(source, "sessionId"),
    timestamp: stringField(source, "timestamp"),
    cwd: stringField(source, "cwd"),
  }
  switch (source.type) {
    case "user":
    case "assistant":
      return decodeConversationRecord(source, base)
    case "summary":
      return { ...base, type: "summary", summary: stringField(source, "summary") }
    case "custom-title":
      return { ...base, type: "custom-title", customTitle: stringField(source, "customTitle") }
    default:
      return { ...base, type: "other" }
  }
}
