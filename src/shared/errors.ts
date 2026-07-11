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
