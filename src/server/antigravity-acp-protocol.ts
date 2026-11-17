import {
  isJsonArray,
  isJsonObject,
  nonEmptyStringField,
  numberField,
  objectField,
  stringField,
  type JsonObject,
  type JsonValue,
} from "../shared/json"

export type AcpRequestId = string | number

export type AcpInbound =
  | { kind: "response"; id: AcpRequestId; result: JsonValue; error: string | null }
  | { kind: "request"; id: AcpRequestId; method: string; params: JsonObject }
  | { kind: "notification"; method: string; params: JsonObject }

export type AcpOutbound =
  | { id: AcpRequestId; method: string; params: JsonObject }
  | { method: string; params: JsonObject }
  | { id: AcpRequestId; result: JsonValue }
  | { id: AcpRequestId; error: { code: number; message: string } }

export const ACP_METHOD_NOT_FOUND = -32601

export function encodeAcpMessage(message: AcpOutbound): string {
  return `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`
}

function requestIdOf(value: JsonValue | undefined): AcpRequestId | null {
  return typeof value === "string" || typeof value === "number" ? value : null
}

export function decodeAcpMessage(value: JsonValue): AcpInbound | null {
  if (!isJsonObject(value)) return null
  const id = requestIdOf(value.id)
  const method = nonEmptyStringField(value, "method")
  const params = objectField(value, "params") ?? {}
  if (method !== null && id !== null) return { kind: "request", id, method, params }
  if (method !== null) return { kind: "notification", method, params }
  if (id === null) return null
  const failure = objectField(value, "error")
  const error = failure === null ? null : stringField(failure, "message") ?? "Unknown error"
  return { kind: "response", id, result: value.result ?? null, error }
}

export interface AcpConfigState {
  model: string | null
  thoughtLevel: string | null
}

export function decodeConfigState(value: JsonValue | undefined): AcpConfigState {
  const state: AcpConfigState = { model: null, thoughtLevel: null }
  if (value === undefined || !isJsonArray(value)) return state
  for (const option of value) {
    if (!isJsonObject(option)) continue
    const current = nonEmptyStringField(option, "currentValue")
    if (option.id === "model") state.model = current
    if (option.id === "thought_level") state.thoughtLevel = current
  }
  return state
}

export interface AcpSessionSetup {
  sessionId: string
  config: AcpConfigState
}

export function decodeSessionSetup(result: JsonValue, requestedSessionId: string | null): AcpSessionSetup {
  const body = isJsonObject(result) ? result : {}
  const sessionId = nonEmptyStringField(body, "sessionId") ?? requestedSessionId
  if (sessionId === null) throw new Error("session/new response carried no sessionId")
  return { sessionId, config: decodeConfigState(body.configOptions) }
}

export interface AcpTurnUsage {
  inputTokens?: number
  outputTokens?: number
  cachedReadTokens?: number
  thoughtTokens?: number
  totalTokens?: number
}

export interface AcpPromptResult {
  stopReason: string
  usage: AcpTurnUsage | null
}

export function decodePromptResult(result: JsonValue): AcpPromptResult {
  const body = isJsonObject(result) ? result : {}
  const usage = objectField(body, "usage")
  return {
    stopReason: stringField(body, "stopReason") ?? "end_turn",
    usage: usage === null
      ? null
      : {
          inputTokens: numberField(usage, "inputTokens"),
          outputTokens: numberField(usage, "outputTokens"),
          cachedReadTokens: numberField(usage, "cachedReadTokens"),
          thoughtTokens: numberField(usage, "thoughtTokens"),
          totalTokens: numberField(usage, "totalTokens"),
        },
  }
}

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed"

export type AcpToolContent =
  | { type: "text"; text: string }
  | { type: "diff"; path: string; newText: string; oldText: string | null }

export interface AcpToolCall {
  id: string
  name: string | null
  kind: string | null
  title: string | null
  status: AcpToolStatus | null
  rawInput: JsonObject
  rawOutput: JsonObject | null
  content: AcpToolContent[]
  paths: string[]
}

export type AcpSessionUpdate =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool"; call: AcpToolCall }
  | { type: "usage"; used: number; size: number | null }
  | { type: "config"; config: AcpConfigState }
  | { type: "ignored" }

const IGNORED: AcpSessionUpdate = { type: "ignored" }

function toolStatusOf(value: string | undefined): AcpToolStatus | null {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "failed"
    ? value
    : null
}

function decodeToolContent(value: JsonValue | undefined): AcpToolContent[] {
  if (value === undefined || !isJsonArray(value)) return []
  const items: AcpToolContent[] = []
  for (const item of value) {
    if (!isJsonObject(item)) continue
    if (item.type === "diff") {
      const path = stringField(item, "path")
      const newText = stringField(item, "newText")
      if (path === undefined || newText === undefined) continue
      items.push({ type: "diff", path, newText, oldText: stringField(item, "oldText") ?? null })
      continue
    }
    const inner = objectField(item, "content")
    const text = inner === null ? undefined : stringField(inner, "text")
    if (text !== undefined) items.push({ type: "text", text })
  }
  return items
}

function decodeLocations(value: JsonValue | undefined): string[] {
  if (value === undefined || !isJsonArray(value)) return []
  const paths: string[] = []
  for (const location of value) {
    if (!isJsonObject(location)) continue
    const path = nonEmptyStringField(location, "path")
    if (path !== null) paths.push(path)
  }
  return paths
}

function decodeToolCall(update: JsonObject): AcpToolCall | null {
  const id = nonEmptyStringField(update, "toolCallId")
  if (id === null) return null
  return {
    id,
    name: nonEmptyStringField(update, "name"),
    kind: nonEmptyStringField(update, "kind"),
    title: nonEmptyStringField(update, "title"),
    status: toolStatusOf(stringField(update, "status")),
    rawInput: objectField(update, "rawInput") ?? objectField(update, "args") ?? {},
    rawOutput: objectField(update, "rawOutput"),
    content: decodeToolContent(update.content),
    paths: decodeLocations(update.locations),
  }
}

function chunkText(update: JsonObject): string {
  const content = objectField(update, "content")
  return content === null ? "" : stringField(content, "text") ?? ""
}

export interface AcpSessionNotification {
  sessionId: string
  update: AcpSessionUpdate
}

export function decodeSessionNotification(params: JsonObject): AcpSessionNotification | null {
  const sessionId = nonEmptyStringField(params, "sessionId")
  const raw = objectField(params, "update")
  if (sessionId === null || raw === null) return null
  switch (raw.sessionUpdate) {
    case "agent_message_chunk":
      return { sessionId, update: { type: "message", text: chunkText(raw) } }
    case "agent_thought_chunk":
      return { sessionId, update: { type: "thought", text: chunkText(raw) } }
    case "tool_call":
    case "tool_call_update": {
      const call = decodeToolCall(raw)
      return { sessionId, update: call === null ? IGNORED : { type: "tool", call } }
    }
    case "usage_update": {
      const used = numberField(raw, "used")
      return { sessionId, update: used === undefined ? IGNORED : { type: "usage", used, size: numberField(raw, "size") ?? null } }
    }
    case "config_option_update":
      return { sessionId, update: { type: "config", config: decodeConfigState(raw.configOptions) } }
    default:
      return { sessionId, update: IGNORED }
  }
}

export function allowOptionIdOf(params: JsonObject): string | null {
  const options = params.options
  if (options === undefined || !isJsonArray(options)) return null
  for (const option of options) {
    if (!isJsonObject(option)) continue
    if (option.kind === "allow_once") return nonEmptyStringField(option, "optionId")
  }
  return null
}
