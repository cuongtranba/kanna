import { mkdir, readFile, writeFile as writeFileFs, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

export type SmokeTestProbeFn = () => Promise<"pass" | "fail">

export interface SmokeTestCacheEntry {
  result: "pass" | "fail"
  ts: number
}

export interface SmokeTestCache {
  get(key: string): Promise<SmokeTestCacheEntry | null>
  set(key: string, entry: SmokeTestCacheEntry): Promise<void>
  invalidate(): Promise<void>
}

export interface SmokeTestGateArgs {
  probe: SmokeTestProbeFn
  cache: SmokeTestCache
  ttlMs: number
  now: () => number
}

export interface CanSpawnArgs {
  binarySha256: string
  model: string
}

export interface SmokeTestGate {
  canSpawn(args: CanSpawnArgs): Promise<{ ok: true } | { ok: false; reason: string }>
}

export function createSmokeTestGate(args: SmokeTestGateArgs): SmokeTestGate {
  const { probe, cache, ttlMs, now } = args
  return {
    async canSpawn(spawnArgs: CanSpawnArgs) {
      const key = `${spawnArgs.binarySha256}|${spawnArgs.model}`
      const cached = await cache.get(key)
      const currentTs = now()
      if (cached && currentTs - cached.ts < ttlMs) {
        if (cached.result === "pass") return { ok: true }
        return { ok: false, reason: "cached smoke test FAIL: --disallowedTools not enforced for this claude binary + model" }
      }
      const probeResult = await probe()
      await cache.set(key, { result: probeResult, ts: currentTs })
      if (probeResult === "pass") return { ok: true }
      return { ok: false, reason: "smoke test FAIL: claude invoked a disallowedTool — refusing spawn" }
    },
  }
}

export function createFileSmokeTestCache(args: { cacheDir: string }): SmokeTestCache {
  const dir = args.cacheDir
  const fileFor = (key: string) => path.join(dir, `${key.replace(/[^a-z0-9._-]/gi, "_")}.json`)
  return {
    async get(key) {
      const fp = fileFor(key)
      if (!existsSync(fp)) return null
      try {
        const raw = await readFile(fp, "utf8")
        const parsed = JSON.parse(raw) as SmokeTestCacheEntry
        if (parsed.result !== "pass" && parsed.result !== "fail") return null
        if (typeof parsed.ts !== "number") return null
        return parsed
      } catch {
        return null
      }
    },
    async set(key, entry) {
      await mkdir(dir, { recursive: true })
      await writeFileFs(fileFor(key), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 })
    },
    async invalidate() {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* swallow */ }
    },
  }
}
