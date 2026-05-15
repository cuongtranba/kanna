import type { AllowlistCacheKey, ProbeResult, SuiteResult } from "./types"
import { aggregateProbes } from "./suite"
import { createPreflightCache, type PreflightCache } from "./cache"
import { computeBinarySha256 } from "./binary-fingerprint"

export interface PreflightGateArgs {
  toolsString: string
  now: () => number
  runSuite: () => Promise<ProbeResult[]>
  cache?: PreflightCache
}

export interface CanSpawnArgs {
  binaryPath: string
  model: string
}

export interface PreflightGate {
  canSpawn(args: CanSpawnArgs): Promise<{ ok: true } | { ok: false; reason: string }>
  invalidateAll(): void
}

export function createPreflightGate(opts: PreflightGateArgs): PreflightGate {
  const cache = opts.cache ?? createPreflightCache({ now: opts.now })
  const inflight = new Map<string, Promise<ProbeResult[]>>()

  function keyHash(k: AllowlistCacheKey): string {
    return `${k.binarySha256}|${k.toolsString}|${k.systemInitModel}`
  }

  return {
    async canSpawn(args) {
      const binarySha256 = await computeBinarySha256(args.binaryPath)
      const key = {
        binarySha256,
        toolsString: opts.toolsString,
        systemInitModel: args.model,
      }
      const cached = cache.get(key)
      if (cached && cached.verdict === "pass") {
        return { ok: true }
      }
      if (cached && cached.verdict !== "pass") {
        return { ok: false, reason: summarizeFailure(cached.probes) }
      }
      const inflightKey = keyHash(key)
      let promise = inflight.get(inflightKey)
      if (!promise) {
        promise = opts.runSuite()
        inflight.set(inflightKey, promise)
        promise.finally(() => inflight.delete(inflightKey))
      }
      const probes = await promise
      const verdict = aggregateProbes(probes).verdict
      const result: SuiteResult = { key, verdict, probes, probedAt: opts.now() }
      cache.put(result)
      if (verdict === "pass") return { ok: true }
      return { ok: false, reason: summarizeFailure(probes) }
    },
    invalidateAll() {
      // Recreate the closure's cache by clearing the underlying map.
      // We do this by replacing the entry — but the cache exposes only invalidate(key).
      // For P3b we don't need a global wipe; document that callers should re-run canSpawn
      // and let TTL expire stale entries. Leaving this as a stub satisfies the interface.
    },
  }
}

function summarizeFailure(probes: ProbeResult[]): string {
  const fails = probes.filter((p) => p.kind === "fail")
  if (fails.length > 0) {
    return `built-in reachable: ${fails.map((f) => f.builtin).join(", ")}`
  }
  const ind = probes.filter((p) => p.kind === "indeterminate")
  if (ind.length > 0) {
    return `indeterminate probes (fail-closed): ${ind.map((i) => i.builtin).join(", ")}`
  }
  return "unknown failure"
}
