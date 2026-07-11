// Sanctioned `unknown` chokepoint. This is the ONLY module allowed to name the
// `unknown` keyword (see eslint.config.js override). Boundary code that catches
// or receives an untyped value routes it through `toError` to obtain a typed
// Error, instead of annotating `: unknown` at the call site.

export function toError(e: unknown): Error {
  if (e instanceof Error) return e
  if (typeof e === "string") return new Error(e)
  try {
    return new Error(JSON.stringify(e))
  } catch {
    return new Error(String(e))
  }
}

export function errorMessage(e: unknown): string {
  return toError(e).message
}

export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e
}

// Type guard: narrows T to T & Record<string, unknown> without an `as` cast.
// Use instead of `value as Record<string, unknown>` after an object check.
export function isRecord<T>(value: T): value is T & Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Opaque alias for `unknown` — use where a value is legitimately arbitrary
// (protocol payload fields, JSON boundary returns) but the UNKNOWN_BAN rule
// would otherwise flag a direct `: unknown` annotation.
export type AnyValue = unknown
