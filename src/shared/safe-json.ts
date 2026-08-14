import type { AnyValue } from "./errors"

/**
 * `JSON.parse` that returns null instead of throwing. Callers that need a
 * shape guard layer it on top (`isRecord`, a type predicate) — the contract
 * here is only "parsed or null". Note `"null"` parses to null and is thus
 * indistinguishable from a failure; every consumer treats null as skip.
 */
export function safeJsonParse(text: string): AnyValue | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
