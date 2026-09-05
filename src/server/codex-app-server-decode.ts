
import { isJsonObject, type JsonValue } from "../shared/json"
import type { CodexRequestId } from "./codex-app-server-protocol"

export type CodexRequestParams = object

export type OutgoingCodexMessage =
  | { id: CodexRequestId; method: string; params: CodexRequestParams }
  | { method: string }
  | { id: CodexRequestId; result: JsonValue }
  | { id: CodexRequestId; error: { message: string } }

export function decodeThreadId(method: string, reply: JsonValue): string {
  const thread = reply !== null && isJsonObject(reply) ? reply.thread : null
  const id = thread !== null && thread !== undefined && isJsonObject(thread) ? thread.id : null
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`codex app-server ${method} reply carried no thread.id`)
  }
  return id
}

export function decodeTurnId(method: string, reply: JsonValue): string {
  const turn = reply !== null && isJsonObject(reply) ? reply.turn : null
  const id = turn !== null && turn !== undefined && isJsonObject(turn) ? turn.id : null
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`codex app-server ${method} reply carried no turn.id`)
  }
  return id
}
