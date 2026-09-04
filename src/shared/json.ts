/**
 * The type a parsed-JSON boundary actually has.
 *
 * Every decoder in this repo reads a value that came out of `JSON.parse`, an
 * HTTP body, or a SQLite text column. Those values were spelled `unknown` —
 * and then, once `unknown` was banned, `AnyValue`, an alias for `unknown` that
 * existed only to evade the ban. Neither says anything: both admit functions,
 * Promises, Symbols and class instances that no JSON boundary can produce.
 *
 * `JsonValue` is strictly more informative and no less safe. It still cannot be
 * used without narrowing, but narrowing it LANDS somewhere: indexing a
 * `JsonObject` yields `JsonValue`, where `isRecord`'s `Record<string, unknown>`
 * yields `unknown` and drops the caller straight back out of the type system.
 *
 * For a value that is genuinely not JSON — a dynamic module namespace — see
 * `dynamic-module.ts`. For a caught throwable, see `errors.ts` `toError`.
 */

export type JsonPrimitive = string | number | boolean | null
export interface JsonObject {
  readonly [key: string]: JsonValue
}
export type JsonArray = readonly JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

/**
 * Narrow to a JSON object.
 *
 * Prefer this over `isRecord` for anything that came from a JSON boundary:
 * `isRecord` widens members to `unknown`, which the type-strictness gate then
 * has no way to keep hold of.
 */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Narrow to a JSON array.
 *
 * `Array.isArray` narrows a `JsonValue` to `JsonArray` correctly on its own
 * (verified against TS7 — its `arg is any[]` predicate does select the readonly
 * union member), so existing `Array.isArray` call sites are already correct and
 * need no migration. This exists for symmetry with `isJsonObject` at sites that
 * read better naming the type they expect.
 */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

/**
 * `JSON.parse` that returns null instead of throwing. Callers that need a shape
 * guard layer it on top (`isJsonObject`, a type predicate) — the contract here
 * is only "parsed or null". Note `"null"` parses to null and is thus
 * indistinguishable from a failure; every consumer treats null as skip.
 */
export function safeJsonParse(text: string): JsonValue | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
