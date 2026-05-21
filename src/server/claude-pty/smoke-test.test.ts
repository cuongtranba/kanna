import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSmokeTestGate, type SmokeTestProbeFn, type SmokeTestCache } from "./smoke-test"

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
