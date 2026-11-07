import {
  inboundNameErrors,
  inboundPathErrors,
  inboundReplyHintErrors,
  inboundTemplateErrors,
  validateInboundTarget,
} from "../inbound/handler"
import { validateMcpSourceAutonomy } from "../inbox/autonomy"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../json"
import { isMcpSourceMode, type McpReplyArg, type McpSource, type McpSourceInput, type McpSourceReply } from "./types"

type McpSourceShape = McpSourceInput | McpSource

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function validateHandler(shape: McpSourceShape): string[] {
  return [
    ...validateInboundTarget(shape.handler),
    ...inboundTemplateErrors(shape.handler.template),
    ...inboundReplyHintErrors(shape.handler.replyHint),
  ]
}

function validateModeFields(shape: McpSourceShape): string[] {
  if (shape.mode === "subscribe") {
    return shape.resourceUris.some(nonEmpty) ? [] : ["At least one resource URI is required"]
  }
  const errors: string[] = []
  const required: readonly [string, string][] = [
    ["Tool", shape.tool],
    ["Cursor argument", shape.cursorArg],
    ["Cursor path", shape.cursorPath],
    ["Items path", shape.itemsPath],
  ]
  for (const [label, value] of required) {
    if (!nonEmpty(value)) errors.push(`${label} is required`)
  }
  if (!isJsonObject(shape.args)) errors.push("Arguments must be a JSON object")
  return errors
}

export function validateMcpSourceReply(reply: McpSourceReply | null | undefined): string[] {
  if (reply === null || reply === undefined) return []
  const errors: string[] = []
  if (!nonEmpty(reply.tool)) errors.push("Reply tool is required")
  for (const [key, arg] of Object.entries(reply.args)) {
    if (!nonEmpty(key)) errors.push("Reply argument names must not be empty")
    if (typeof arg !== "string" && Object.keys(arg.map).length === 0) {
      errors.push(`Reply argument "${key}" needs at least one mapping`)
    }
  }
  errors.push(...inboundPathErrors([reply.resultIdPath]))
  return errors
}

export function validateMcpSource(shape: McpSourceShape): string[] {
  const errors: string[] = []
  errors.push(...inboundNameErrors(shape.name))
  if (!nonEmpty(shape.serverId)) errors.push("An MCP server is required")
  if (!isMcpSourceMode(shape.mode)) errors.push("Mode must be subscribe or poll")
  else errors.push(...validateModeFields(shape))
  errors.push(...inboundPathErrors([shape.threadKeyPath, shape.senderPath, shape.textPath, shape.itemsPath, shape.itemKeyPath]))
  errors.push(...validateHandler(shape))
  errors.push(...validateMcpSourceReply(shape.reply))
  errors.push(...validateMcpSourceAutonomy(shape.autonomy, shape.reply !== null && shape.reply !== undefined))
  return errors
}

export function parseMcpSourceArgs(value: string): { args: JsonObject } | { error: string } {
  const text = value.trim()
  if (text.length === 0) return { args: {} }
  const parsed = safeJsonParse(text)
  return parsed !== null && isJsonObject(parsed) ? { args: parsed } : { error: "Arguments must be a JSON object" }
}

export function readMcpReplyArg(value: JsonValue): McpReplyArg | null {
  if (typeof value === "string") return value
  if (!isJsonObject(value)) return null
  const { from, map } = value
  if (typeof from !== "string" || map === undefined || !isJsonObject(map)) return null
  return value.default === undefined ? { from, map } : { from, map, default: value.default }
}

export function parseMcpReplyArgs(value: string): { args: Record<string, McpReplyArg> } | { error: string } {
  const text = value.trim()
  if (text.length === 0) return { args: {} }
  const parsed = safeJsonParse(text)
  if (parsed === null || !isJsonObject(parsed)) return { error: "Reply arguments must be a JSON object" }
  const args: Record<string, McpReplyArg> = {}
  for (const [key, raw] of Object.entries(parsed)) {
    const arg = readMcpReplyArg(raw)
    if (arg === null) return { error: `Reply argument "${key}" must be a string or an object with "from" and "map"` }
    args[key] = arg
  }
  return { args }
}
