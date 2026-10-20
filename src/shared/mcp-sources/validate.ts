import { validateInboundTarget } from "../inbound/handler"
import { isJsonObject, safeJsonParse, type JsonObject } from "../json"
import {
  MCP_SOURCE_NAME_MAX,
  MCP_SOURCE_PATH_MAX,
  MCP_SOURCE_REPLY_HINT_MAX,
  MCP_SOURCE_TEMPLATE_MAX,
  isMcpSourceMode,
  type McpSource,
  type McpSourceInput,
} from "./types"

type McpSourceShape = McpSourceInput | McpSource

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function validateHandler(shape: McpSourceShape): string[] {
  const errors = validateInboundTarget(shape.handler)
  const template = shape.handler.template.trim()
  if (template.length === 0) errors.push("Template is required")
  if (template.length > MCP_SOURCE_TEMPLATE_MAX) errors.push(`Template must be at most ${MCP_SOURCE_TEMPLATE_MAX} characters`)
  if (shape.handler.replyHint.length > MCP_SOURCE_REPLY_HINT_MAX) {
    errors.push(`Reply hint must be at most ${MCP_SOURCE_REPLY_HINT_MAX} characters`)
  }
  return errors
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
  const name = shape.name.trim()
  if (name.length === 0) errors.push("Name is required")
  if (name.length > MCP_SOURCE_NAME_MAX) errors.push(`Name must be at most ${MCP_SOURCE_NAME_MAX} characters`)
  if (!nonEmpty(shape.serverId)) errors.push("An MCP server is required")
  if (!isMcpSourceMode(shape.mode)) errors.push("Mode must be subscribe or poll")
  else errors.push(...validateModeFields(shape))
  const paths = [shape.threadKeyPath, shape.senderPath]
  if (paths.some((path) => path.length > MCP_SOURCE_PATH_MAX)) {
    errors.push(`Paths must be at most ${MCP_SOURCE_PATH_MAX} characters`)
  }
  errors.push(...validateHandler(shape))
  return errors
}

export function parseMcpSourceArgs(value: string): { args: JsonObject } | { error: string } {
  const text = value.trim()
  if (text.length === 0) return { args: {} }
  const parsed = safeJsonParse(text)
  return parsed !== null && isJsonObject(parsed) ? { args: parsed } : { error: "Arguments must be a JSON object" }
}
