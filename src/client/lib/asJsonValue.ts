import { isRecord } from "../../shared/errors"
import type { JsonValue } from "../../shared/json"

/**
 * The one place the client converts a host-supplied value into `JsonValue`.
 *
 * Three boundaries hand us a value the compiler cannot describe and that no
 * guard can narrow in a single step: zustand's `persist` middleware (its
 * `migrate` / `merge` hooks are declared over the raw deserialized blob), and
 * a transcript entry's `content`, whose shared type still spells its members
 * with `unknown` inside `Record`/array wrappers.
 *
 * It is a WALK, not an assertion: anything a JSON round-trip could not have
 * produced (a function, a Symbol, `NaN`, an `undefined` member) is dropped
 * exactly as `JSON.stringify` would drop it, so the result really is JSON
 * rather than merely typed as such. Primitives and `null` — the common case
 * for a tool result — short-circuit without allocating.
 */
export function asJsonValue<T>(value: T): JsonValue {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      return Number.isFinite(value) ? value : null
  }
  if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry))
  if (isRecord(value)) {
    const encoded: Record<string, JsonValue> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) encoded[key] = asJsonValue(entry)
    }
    return encoded
  }
  return null
}
