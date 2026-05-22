import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSmokeTestGate, createFileSmokeTestCache, type SmokeTestProbeFn, type SmokeTestCache } from "./smoke-test"

let workHome: string

function inMemoryCache(): SmokeTestCache {
  const store = new Map<string, { result: "pass" | "fail"; ts: number }>()
  return {
    async get(key) { return store.get(key) ?? null },
    async set(key, entry) { store.set(key, entry) },
    async invalidate() { store.clear() },
  }
}

beforeEach(async () => {
  workHome = await mkdtemp(path.join(tmpdir(), "kanna-smoke-"))
  await writeFile(path.join(workHome, "fake-claude"), "#!/bin/sh\necho fake\n", { mode: 0o755 })
})

afterEach(async () => {
  await rm(workHome, { recursive: true, force: true })
})

describe("createSmokeTestGate", () => {
  test("cached PASS skips probe", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    await cache.set("aaa|claude-opus-4-7", { result: "pass", ts: Date.now() })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "aaa", model: "claude-opus-4-7" })
    expect(result.ok).toBe(true)
    expect(probeRan).toBe(false)
  })

  test("cached FAIL refuses spawn without running probe", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    await cache.set("bbb|claude-opus-4-7", { result: "fail", ts: Date.now() })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "bbb", model: "claude-opus-4-7" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/disallowedTools/i)
    expect(probeRan).toBe(false)
  })

  test("cache miss runs probe and caches PASS", async () => {
    let probeRan = false
    const probe: SmokeTestProbeFn = async () => { probeRan = true; return "pass" }
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "ccc", model: "m1" })
    expect(result.ok).toBe(true)
    expect(probeRan).toBe(true)
    const cached = await cache.get("ccc|m1")
    expect(cached?.result).toBe("pass")
  })

  test("cache miss runs probe and refuses spawn on FAIL", async () => {
    const probe: SmokeTestProbeFn = async () => "fail"
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const result = await gate.canSpawn({ binarySha256: "ddd", model: "m1" })
    expect(result.ok).toBe(false)
    const cached = await cache.get("ddd|m1")
    expect(cached?.result).toBe("fail")
  })

  test("expired cache entry triggers re-probe", async () => {
    let probeRan = 0
    const probe: SmokeTestProbeFn = async () => { probeRan++; return "pass" }
    const cache = inMemoryCache()
    let nowMs = 1_000_000
    await cache.set("eee|m1", { result: "pass", ts: nowMs })
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 1000, now: () => nowMs })
    await gate.canSpawn({ binarySha256: "eee", model: "m1" })
    expect(probeRan).toBe(0)
    nowMs += 2000
    await gate.canSpawn({ binarySha256: "eee", model: "m1" })
    expect(probeRan).toBe(1)
  })
})

describe("createSmokeTestGate singleflight (adr-20260522-oauth-token-share-cap)", () => {
  test("concurrent canSpawn calls on same (sha,model) collapse to one probe", async () => {
    let probeStartCount = 0
    const resolvers: Array<(r: "pass" | "fail") => void> = []
    const probe: SmokeTestProbeFn = () => {
      probeStartCount += 1
      return new Promise<"pass" | "fail">((r) => { resolvers.push(r) })
    }
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })

    const results = [
      gate.canSpawn({ binarySha256: "fff", model: "m1" }),
      gate.canSpawn({ binarySha256: "fff", model: "m1" }),
      gate.canSpawn({ binarySha256: "fff", model: "m1" }),
      gate.canSpawn({ binarySha256: "fff", model: "m1" }),
      gate.canSpawn({ binarySha256: "fff", model: "m1" }),
    ]
    // Give the event loop one tick so each promise registers with inFlight.
    await Promise.resolve()
    expect(probeStartCount).toBe(1)
    expect(resolvers).toHaveLength(1)
    resolvers[0]("pass")
    const resolved = await Promise.all(results)
    for (const r of resolved) expect(r.ok).toBe(true)
    expect(probeStartCount).toBe(1)
  })

  test("after a probe resolves, future cache-miss callers run a fresh probe", async () => {
    let probeStartCount = 0
    const probe: SmokeTestProbeFn = async () => { probeStartCount += 1; return "pass" }
    const cache: SmokeTestCache = {
      // Read-only cache: every get returns null so the gate must probe each time.
      async get() { return null },
      async set() { /* discard */ },
      async invalidate() { /* noop */ },
    }
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    await gate.canSpawn({ binarySha256: "ggg", model: "m1" })
    await gate.canSpawn({ binarySha256: "ggg", model: "m1" })
    // Two sequential cache-miss calls → two probes (singleflight only collapses concurrent ones).
    expect(probeStartCount).toBe(2)
  })

  test("singleflight is keyed by (sha,model) — different keys probe independently", async () => {
    let probeStartCount = 0
    const resolvers: Array<(r: "pass" | "fail") => void> = []
    const probe: SmokeTestProbeFn = () => {
      probeStartCount += 1
      return new Promise<"pass" | "fail">((r) => { resolvers.push(r) })
    }
    const cache = inMemoryCache()
    const gate = createSmokeTestGate({ probe, cache, ttlMs: 24 * 3600 * 1000, now: () => Date.now() })
    const a = gate.canSpawn({ binarySha256: "hhh", model: "m1" })
    const b = gate.canSpawn({ binarySha256: "hhh", model: "m2" })
    await Promise.resolve()
    expect(probeStartCount).toBe(2)
    expect(resolvers).toHaveLength(2)
    resolvers[0]("pass")
    resolvers[1]("pass")
    await Promise.all([a, b])
  })
})

describe("createFileSmokeTestCache", () => {
  test("round-trips an entry through disk", async () => {
    const dir = path.join(workHome, "smoke-cache")
    const cache = createFileSmokeTestCache({ cacheDir: dir })
    await cache.set("abc|m1", { result: "pass", ts: 1234 })
    const got = await cache.get("abc|m1")
    expect(got).toEqual({ result: "pass", ts: 1234 })
  })

  test("returns null on missing key", async () => {
    const cache = createFileSmokeTestCache({ cacheDir: path.join(workHome, "smoke-cache-2") })
    const got = await cache.get("missing|m1")
    expect(got).toBeNull()
  })

  test("invalidate wipes the dir", async () => {
    const dir = path.join(workHome, "smoke-cache-3")
    const cache = createFileSmokeTestCache({ cacheDir: dir })
    await cache.set("xxx|m", { result: "pass", ts: 1 })
    await cache.invalidate()
    expect(await cache.get("xxx|m")).toBeNull()
  })
})
