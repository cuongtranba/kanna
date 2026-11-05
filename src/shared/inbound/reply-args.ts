import { jsonText, resolveJsonPath, type JsonObject, type JsonValue } from "../json"
import type { McpReplyArg, McpSourceReply } from "../mcp-sources/types"
import { exactPlaceholderPath, placeholderPaths, substituteInboundTemplate } from "./template"

export type ReplyArgsResult = { ok: true; args: JsonObject } | { ok: false; error: string }

interface Resolved {
  value: JsonValue
}

function lookup(scope: JsonValue, path: string): Resolved | null {
  const value = resolveJsonPath(scope, path)
  return value === undefined || jsonText(value) === "" ? null : { value }
}

function unresolved(key: string, path: string): string {
  return `Reply argument "${key}" needs "${path}", which is empty in this message`
}

function resolveArg(key: string, arg: McpReplyArg, scope: JsonValue): Resolved | string {
  if (typeof arg !== "string") {
    const source = lookup(scope, arg.from)
    if (source === null) return unresolved(key, arg.from)
    const mapKey = jsonText(source.value)
    if (Object.hasOwn(arg.map, mapKey)) return { value: arg.map[mapKey]! }
    if (arg.default !== undefined) return { value: arg.default }
    return `Reply argument "${key}" has no mapping for "${mapKey}" and no default`
  }
  const exact = exactPlaceholderPath(arg)
  if (exact !== null) {
    const found = lookup(scope, exact)
    return found ?? unresolved(key, exact)
  }
  const missing = placeholderPaths(arg).find((path) => lookup(scope, path) === null)
  if (missing !== undefined) return unresolved(key, missing)
  return { value: substituteInboundTemplate(arg, scope) }
}

export function resolveReplyArgs(reply: McpSourceReply, message: JsonValue, text: string): ReplyArgsResult {
  const scope: JsonValue = { message, reply: { text } }
  const args: Record<string, JsonValue> = {}
  for (const [key, arg] of Object.entries(reply.args)) {
    const resolved = resolveArg(key, arg, scope)
    if (typeof resolved === "string") return { ok: false, error: resolved }
    args[key] = resolved.value
  }
  return { ok: true, args }
}
