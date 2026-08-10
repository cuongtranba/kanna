import { toError } from "./errors"

// A hashed chunk that vanished from the server — the tab is running a build the
// server no longer serves. Each engine words this differently; matching only
// Chrome's phrasing would miss Firefox and Safari entirely.
const STALE_CHUNK_SIGNATURES = [
  "failed to fetch dynamically imported module", // Chrome / Edge
  "error loading dynamically imported module", // Firefox
  "importing a module script failed", // Safari
]

/**
 * True when the error means "this lazy chunk is gone", which happens when the
 * server was upgraded while the tab stayed open. Recoverable by reloading.
 */
export function isStaleChunkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return STALE_CHUNK_SIGNATURES.some((signature) => message.includes(signature))
}

/**
 * Wraps a dynamic `import()` so the resolved module is cached but a *failure*
 * is not. Caching the rejected promise (the obvious `promise ??= import(...)`)
 * poisons the loader for the life of the tab: one missing chunk permanently
 * breaks every later consumer, even once the chunk is reachable again.
 */
export function createLazyLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null

  return () => {
    if (!cached) {
      cached = load().catch((error) => {
        // Drop the cache before rethrowing so the next call retries.
        cached = null
        throw toError(error)
      })
    }
    return cached
  }
}
