import type { AllowlistCacheKey, SuiteResult } from "./types"

const TTL_MS = 24 * 60 * 60 * 1000

function keyToString(k: AllowlistCacheKey): string {
  return `${k.binarySha256}|${k.toolsString}|${k.systemInitModel}`
}

export interface PreflightCache {
  get(key: AllowlistCacheKey): SuiteResult | null
  put(result: SuiteResult): void
  invalidate(key: AllowlistCacheKey): void
}

export function createPreflightCache(opts: { now: () => number; ttlMs?: number }): PreflightCache {
  const map = new Map<string, SuiteResult>()
  const ttl = opts.ttlMs ?? TTL_MS
  return {
    get(key) {
      const k = keyToString(key)
      const entry = map.get(k)
      if (!entry) return null
      if (opts.now() - entry.probedAt > ttl) {
        map.delete(k)
        return null
      }
      return entry
    },
    put(result) {
      map.set(keyToString(result.key), result)
    },
    invalidate(key) {
      map.delete(keyToString(key))
    },
  }
}
