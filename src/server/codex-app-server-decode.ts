/**
 * codex-app-server-decode — the transport's wire vocabulary: what this
 * transport is allowed to write, and how a reply's ids are read back.
 *
 * Extracted from codex-app-server so these pure decoders do not count against
 * that module's architecture-budget ceiling.
 */

import { isJsonObject, type JsonValue } from "../shared/json"
import type { CodexRequestId } from "./codex-app-server-protocol"

/**
 * A JSON-RPC request's `params`. Deliberately just "an object": every call site
 * pins the real shape with `satisfies <Method>Params`, and an optional field
 * left `undefined` (`serviceTier`) is legal here while `JsonValue` rejects it.
 */
export type CodexRequestParams = object

/**
 * Every message this transport writes. It replaced `Record<string, unknown>`,
 * which said nothing and admitted anything.
 *
 * `params` stays `CodexRequestParams` (an `object`) rather than `JsonObject`
 * because the generated request-param types are INTERFACES, and a TypeScript
 * interface never satisfies an index-signature type. Each call site pins its
 * shape with `satisfies ThreadStartParams` etc., which is the stronger check.
 */
export type OutgoingCodexMessage =
  | { id: CodexRequestId; method: string; params: CodexRequestParams }
  | { method: string }
  | { id: CodexRequestId; result: JsonValue }
  | { id: CodexRequestId; error: { message: string } }

/**
 * Read the thread id out of a `thread/start | thread/resume | thread/fork`
 * reply.
 *
 * Hand-written rather than asserted: the transport resolves a `JsonValue`, and
 * `ThreadStartResponse` is a generated INTERFACE, so no narrowing reaches it
 * and a cast is banned. Only `thread.id` is ever read downstream, so that is
 * all this promises — and a reply missing it throws here, naming the method,
 * instead of poisoning `context.sessionToken` with `undefined`.
 */
export function decodeThreadId(method: string, reply: JsonValue): string {
  const thread = reply !== null && isJsonObject(reply) ? reply.thread : null
  const id = thread !== null && thread !== undefined && isJsonObject(thread) ? thread.id : null
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`codex app-server ${method} reply carried no thread.id`)
  }
  return id
}

/** `decodeThreadId` for a `turn/start` reply — same reasoning, `turn.id`. */
export function decodeTurnId(method: string, reply: JsonValue): string {
  const turn = reply !== null && isJsonObject(reply) ? reply.turn : null
  const id = turn !== null && turn !== undefined && isJsonObject(turn) ? turn.id : null
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`codex app-server ${method} reply carried no turn.id`)
  }
  return id
}
