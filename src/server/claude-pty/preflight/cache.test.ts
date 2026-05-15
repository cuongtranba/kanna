import { describe, expect, test } from "bun:test"
import { createPreflightCache } from "./cache"
import type { SuiteResult } from "./types"

const baseSuiteResult: SuiteResult = {
  key: { binarySha256: "sha-a", toolsString: "mcp__kanna__*", systemInitModel: "m1" },
  verdict: "pass",
  probes: [],
  probedAt: 0,
}

describe("preflight cache", () => {
  test("get returns null when key missing", () => {
    const c = createPreflightCache({ now: () => 0 })
    expect(c.get({ binarySha256: "x", toolsString: "y", systemInitModel: "z" })).toBeNull()
  })

  test("put then get returns the cached result", () => {
    const c = createPreflightCache({ now: () => 0 })
    c.put(baseSuiteResult)
    const got = c.get(baseSuiteResult.key)
    expect(got?.verdict).toBe("pass")
  })

  test("returns null when entry is older than 24h", () => {
    let nowVal = 0
    const c = createPreflightCache({ now: () => nowVal })
    c.put({ ...baseSuiteResult, probedAt: 0 })
    nowVal = 25 * 60 * 60 * 1000
    expect(c.get(baseSuiteResult.key)).toBeNull()
  })

  test("invalidate(key) removes the entry", () => {
    const c = createPreflightCache({ now: () => 0 })
    c.put(baseSuiteResult)
    c.invalidate(baseSuiteResult.key)
    expect(c.get(baseSuiteResult.key)).toBeNull()
  })

  test("different binarySha256 → different entry", () => {
    const c = createPreflightCache({ now: () => 0 })
    c.put(baseSuiteResult)
    expect(c.get({ ...baseSuiteResult.key, binarySha256: "sha-b" })).toBeNull()
  })
})
