
import { isJsonObject, type JsonValue } from "../shared/json"
import type { CodexRequestId } from "./codex-app-server-protocol"

export type CodexRequestParams = object

export type OutgoingCodexMessage =
  | { id: CodexRequestId; method: string; params: CodexRequestParams }
  | { method: string }
  | { id: CodexRequestId; result: JsonValue }
  | { id: CodexRequestId; error: { message: string } }

export function decodeNestedId(method: string, reply: JsonValue, key: "thread" | "turn"): string {
  const nested = reply !== null && isJsonObject(reply) ? reply[key] : null
  const id = nested !== null && nested !== undefined && isJsonObject(nested) ? nested.id : null
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`codex app-server ${method} reply carried no ${key}.id`)
  }
  return id
}
