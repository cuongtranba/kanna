import { describe, expect, test } from "bun:test"
import {
  PM2_MAX_MEMORY_RESTART_BYTES,
  SAFE_HOST_MEMORY_FRACTION,
  resolveMemoryCeiling,
  resolveRssRatio,
} from "./memory-ceiling"

const GIB = 1024 * 1024 * 1024

describe("resolveMemoryCeiling", () => {
  test("a small machine is bounded by its own RAM, not by the pm2 clamp", () => {
    const ceiling = resolveMemoryCeiling({ totalBytes: 2 * GIB, underPm2: true })
    expect(ceiling).toBe(2 * GIB * SAFE_HOST_MEMORY_FRACTION)
    expect(ceiling).toBeLessThan(PM2_MAX_MEMORY_RESTART_BYTES)
  })

  test("a 4 GiB machine under pm2 is still bounded by the clamp", () => {
    expect(resolveMemoryCeiling({ totalBytes: 4 * GIB, underPm2: true }))
      .toBe(PM2_MAX_MEMORY_RESTART_BYTES)
  })

  test("a large machine under pm2 is bounded by the clamp it cannot raise", () => {
    expect(resolveMemoryCeiling({ totalBytes: 64 * GIB, underPm2: true }))
      .toBe(PM2_MAX_MEMORY_RESTART_BYTES)
  })

  test("a large machine without pm2 keeps the whole host allowance", () => {
    expect(resolveMemoryCeiling({ totalBytes: 64 * GIB, underPm2: false }))
      .toBe(64 * GIB * SAFE_HOST_MEMORY_FRACTION)
  })

  test("an unreadable total falls back to the clamp rather than to zero", () => {
    for (const totalBytes of [0, Number.NaN, -1]) {
      expect(resolveMemoryCeiling({ totalBytes, underPm2: false }), String(totalBytes))
        .toBe(PM2_MAX_MEMORY_RESTART_BYTES)
    }
  })
})

describe("resolveRssRatio", () => {
  test("the pressure the alert reads is a fraction of this machine's ceiling", () => {
    expect(resolveRssRatio(1.6 * GIB, 2 * GIB)).toBeCloseTo(0.8, 5)
  })

  test("the same RSS is alarming on a small machine and calm on a large one", () => {
    const rss = 1.9 * GIB
    const small = resolveRssRatio(rss, resolveMemoryCeiling({ totalBytes: 4 * GIB, underPm2: false }))
    const large = resolveRssRatio(rss, resolveMemoryCeiling({ totalBytes: 64 * GIB, underPm2: false }))
    expect(small).toBeGreaterThan(0.5)
    expect(large).toBeLessThan(0.05)
  })

  test("a pm2 install still trips at the clamp on a machine with plenty of RAM", () => {
    const ceiling = resolveMemoryCeiling({ totalBytes: 64 * GIB, underPm2: true })
    expect(resolveRssRatio(1.9 * GIB, ceiling)).toBeGreaterThan(0.9)
  })

  test("an unusable ceiling reports no pressure rather than Infinity", () => {
    expect(resolveRssRatio(GIB, 0)).toBe(0)
  })
})
