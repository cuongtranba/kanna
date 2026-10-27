import {
  inboundNameErrors,
  inboundPathErrors,
  inboundReplyHintErrors,
  inboundTemplateErrors,
  validateInboundTarget,
} from "../inbound/handler"
import { isJsonObject, safeJsonParse, type JsonObject } from "../json"
import { isMcpSourceMode, type McpSource, type McpSourceInput } from "./types"

type McpSourceShape = McpSourceInput | McpSource

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function validateHandler(shape: McpSourceShape): string[] {
  return [
    ...validateInboundTarget(shape.handler),
    ...inboundTemplateErrors(shape.handler.template, { required: true }),
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

export function validateMcpSource(shape: McpSourceShape): string[] {
  const errors: string[] = []
  errors.push(...inboundNameErrors(shape.name))
  if (!nonEmpty(shape.serverId)) errors.push("An MCP server is required")
  if (!isMcpSourceMode(shape.mode)) errors.push("Mode must be subscribe or poll")
  else errors.push(...validateModeFields(shape))
  errors.push(...inboundPathErrors([shape.threadKeyPath, shape.senderPath]))
  errors.push(...validateHandler(shape))
  return errors
}

export function parseMcpSourceArgs(value: string): { args: JsonObject } | { error: string } {
  const text = value.trim()
  if (text.length === 0) return { args: {} }
  const parsed = safeJsonParse(text)
  return parsed !== null && isJsonObject(parsed) ? { args: parsed } : { error: "Arguments must be a JSON object" }
}
