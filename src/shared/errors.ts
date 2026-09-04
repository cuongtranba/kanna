// Sanctioned `unknown` chokepoint for THROWN values. Boundary code that catches
// or receives a throwable routes it through `toError` to obtain a typed Error,
// instead of annotating `: unknown` at the call site.
//
// Two sibling modules cover the other boundaries, so that each one names a
// specific kind of untyped value rather than "anything at all":
//   - src/shared/json.ts           — parsed JSON (`JsonValue`)
//   - src/shared/dynamic-module.ts — dynamic import()/require() namespaces
//
// See eslint.config.js: these are the only files exempt from the unknown ban.

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

/**
 * Wrap a rejection handler so it receives a typed `Error`.
 *
 * `Promise.catch` declares its callback parameter as `any` (lib.es5.d.ts), so an
 * un-annotated `.catch((cause) => …)` silently hands the body an `any` that no
 * rule can see. Annotating the parameter was the only defence available, which
 * is why ~30 call sites read `.catch((cause: AnyValue) => …)` — untyped, just
 * spelled differently.
 *
 * `onRejected` closes that hole at the one place it exists:
 *
 * ```ts
 * void doWork().catch(onRejected((error) => setError(error.message)))
 * ```
 */
export function onRejected(handle: (error: Error) => void): (reason: unknown) => void {
  return (reason) => {
    handle(toError(reason))
  }
}

