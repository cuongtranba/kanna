import type { ZodType } from "zod"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"

export interface PluginRpcContract {
  readonly name: string
  readonly input: ZodType<JsonValue>
  readonly output: ZodType<JsonValue>
}

export function defineRpc<T extends PluginRpcContract>(contract: T): T {
  return contract
}

export interface PluginHostCallMessage {
  readonly type: "call"
  readonly id: string
  readonly method: string
  readonly params: JsonValue
}

export type PluginChildMessage =
  | { readonly type: "ready" }
  | { readonly type: "result"; readonly id: string; readonly ok: true; readonly output: JsonValue }
  | { readonly type: "result"; readonly id: string; readonly ok: false; readonly error: string }

export function encodePluginLine(message: PluginHostCallMessage | PluginChildMessage): string {
  return `${JSON.stringify(message)}\n`
}

function readString(source: JsonObject, key: string): string | null {
  const value = source[key]
  return typeof value === "string" ? value : null
}

function parseJsonLine(line: string): JsonValue | null {
  return safeJsonParse(line)
}

export function parsePluginHostCallMessage(line: string): PluginHostCallMessage | null {
  const parsed = parseJsonLine(line)
  if (parsed === null || !isJsonObject(parsed) || parsed.type !== "call") return null
  const id = readString(parsed, "id")
  const method = readString(parsed, "method")
  if (id === null || method === null) return null
  return { type: "call", id, method, params: parsed.params }
}

export function parsePluginChildMessage(line: string): PluginChildMessage | null {
  const parsed = parseJsonLine(line)
  if (parsed === null || !isJsonObject(parsed)) return null
  if (parsed.type === "ready") return { type: "ready" }
  if (parsed.type !== "result") return null
  const id = readString(parsed, "id")
  if (id === null) return null
  if (parsed.ok === true) return { type: "result", id, ok: true, output: parsed.output }
  if (parsed.ok === false) return { type: "result", id, ok: false, error: readString(parsed, "error") ?? "plugin RPC call failed" }
  return null
}
