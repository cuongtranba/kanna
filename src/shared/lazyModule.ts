import { toError } from "./errors"

const STALE_CHUNK_SIGNATURES = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
]

export function isStaleChunkError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return STALE_CHUNK_SIGNATURES.some((signature) => message.includes(signature))
}

export function createLazyLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null

  return () => {
    if (!cached) {
      cached = load().catch((error) => {
        cached = null
        throw toError(error)
      })
    }
    return cached
  }
}
