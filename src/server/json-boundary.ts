/**
 * Re-read a host-typed value as the JSON it already is.
 *
 * A few boundaries hand the server a value the compiler describes only as a
 * domain interface or an SDK-internal shape: a tool response arriving over the
 * wire, a `structured_output` attachment, a transcript entry's tool payload on
 * its way into a share snapshot, a codex `ThreadItem` of a type these bindings
 * do not know. Each of those is JSON that has already survived a serialization
 * hop — but nothing in the type system proves it, and a TypeScript **interface
 * never satisfies an index-signature type**, so `JsonObject` cannot be reached
 * from one by narrowing at all. This repo bans the assertion that would claim
 * it anyway.
 *
 * So the value is ENCODED rather than asserted: `encodeJson` walks it once and
 * builds a `JsonValue` out of primitives, arrays and plain keys. Whatever comes
 * back is JSON by construction, and anything that was never JSON (a function, a
 * Symbol, a cycle, `undefined`) is dropped exactly where `JSON.stringify` would
 * drop it instead of being smuggled through a cast.
 *
 * It is a SINGLE PASS on purpose. The predecessor was
 * `JSON.parse(JSON.stringify(x))`, which pays for a whole intermediate string —
 * and these sit on per-message paths (`quick-response.ts` runs one per SDK
 * message). Serializing to throw the bytes away is the cost this avoids.
 *
 * Use it only where the value genuinely is a JSON payload; a value with a
 * knowable shape deserves a hand-written encoder that names its fields.
 */

import { isRecord } from "../shared/errors"
import { isJsonArray, isJsonObject, type JsonArray, type JsonObject, type JsonValue } from "../shared/json"

/** Depth ceiling. JSON from a wire boundary is never this deep; a cycle is. */
const MAX_DEPTH = 64

function hasToJson<T>(value: T): value is T & { toJSON: () => JsonValue } {
  return isRecord(value) && typeof value.toJSON === "function"
}

/**
 * Encode one value. Returns `undefined` for anything JSON cannot carry, which
 * is the signal callers use to drop an object key — the same thing
 * `JSON.stringify` does with an `undefined`, a function or a Symbol.
 */
function encodeJson<T>(value: T, depth: number): JsonValue | undefined {
  if (value === null) return null
  const kind = typeof value
  if (kind === "string" || kind === "boolean") {
    return typeof value === "string" || typeof value === "boolean" ? value : undefined
  }
  if (typeof value === "number") {
    // JSON has no NaN/Infinity; `JSON.stringify` writes them as null.
    return Number.isFinite(value) ? value : null
  }
  if (kind !== "object") return undefined
  if (depth >= MAX_DEPTH) return null

  if (hasToJson(value)) return encodeJson(value.toJSON(), depth + 1)

  if (Array.isArray(value)) {
    const out: JsonValue[] = []
    for (const item of value) {
      out.push(encodeJson(item, depth + 1) ?? null)
    }
    return out
  }

  if (!isRecord(value)) return undefined
  const out: { [key: string]: JsonValue } = {}
  for (const [key, item] of Object.entries(value)) {
    const encoded = encodeJson(item, depth + 1)
    if (encoded !== undefined) out[key] = encoded
  }
  return out
}

export function toJsonValue<T>(value: T): JsonValue | null {
  return encodeJson(value, 0) ?? null
}

/** `toJsonValue` for a payload the caller needs as an object; anything else reads as `{}`. */
export function toJsonObject<T>(value: T): JsonObject {
  const json = encodeJson(value, 0)
  return json !== null && json !== undefined && isJsonObject(json) ? json : {}
}

/** `toJsonValue` for a payload the caller needs as an array; anything else reads as `[]`. */
export function toJsonArray<T>(value: T): JsonArray {
  const json = encodeJson(value, 0)
  return json !== null && json !== undefined && isJsonArray(json) ? json : []
}
