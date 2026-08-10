import { describe, expect, test } from "bun:test"
import {
  ENTRY_SIZE_PERCENTILES,
  makeSizedEntry,
  mulberry32,
  sampleEntryBytes,
  summarizeSizes,
} from "./entry-fixture"

/**
 * These assertions exist because a benchmark fixture that silently loses its
 * TAIL produces confident, wrong numbers. The July 2026 long-session OKR ran
 * on a uniform ~1 KB fixture, measured the snapshot-derive path at 0.09 ms per
 * tick, and shipped. On a fixture sampled from the real corpus the same path
 * costs ~17 ms — a ~190x underestimate — and the 200-entry window it declared
 * safe weighs up to 3.89 MB in production.
 *
 * So the shape of the distribution is a CONTRACT, not an implementation
 * detail. Simplifying the generator back toward "one size for every entry"
 * must fail here rather than quietly re-arm the same blind spot.
 */
const SAMPLE_N = 20_000

function sampleMany(seed = 0x5eed, n = SAMPLE_N): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: n }, () => sampleEntryBytes(rng))
}

describe("bench entry fixture", () => {
  test("reproduces the measured median within 15%", () => {
    const { p50 } = summarizeSizes(sampleMany())
    const target = ENTRY_SIZE_PERCENTILES.p50
    expect(Math.abs(p50 - target) / target).toBeLessThan(0.15)
  })

  test("reproduces the measured p95 within 20%", () => {
    const { p95 } = summarizeSizes(sampleMany())
    const target = ENTRY_SIZE_PERCENTILES.p95
    expect(Math.abs(p95 - target) / target).toBeLessThan(0.2)
  })

  test("HAS A TAIL — p95 is an order of magnitude above the median", () => {
    // The single property the old fixture lacked. Under a uniform generator
    // this ratio is ~1 and the byte cost of a window cannot vary with content.
    const { p50, p95 } = summarizeSizes(sampleMany())
    expect(p95 / p50).toBeGreaterThan(8)
  })

  test("produces entries far larger than any uniform fixture would", () => {
    const { max } = summarizeSizes(sampleMany())
    expect(max).toBeGreaterThan(100_000)
  })

  test("is deterministic for a given seed", () => {
    expect(sampleMany(42, 500)).toEqual(sampleMany(42, 500))
  })

  test("different seeds explore different draws", () => {
    expect(sampleMany(1, 500)).not.toEqual(sampleMany(2, 500))
  })

  test("emitted entries land near their target size", () => {
    const rng = mulberry32(7)
    for (const target of [500, 2_000, 20_000, 200_000]) {
      const serialized = JSON.stringify(makeSizedEntry(1, target, rng)).length
      // Within 25% — envelope overhead and JSON escaping move the exact bytes.
      expect(Math.abs(serialized - target) / target).toBeLessThan(0.25)
    }
  })

  test("fat draws are emitted as tool_result, preserving the kind/size link", () => {
    const rng = mulberry32(11)
    // tool_result is 34% of a real window and carries its tail (mean 19.5 KB).
    const entry = makeSizedEntry(3, 200_000, rng) as { kind: string }
    expect(entry.kind).toBe("tool_result")
  })

  test("a 200-entry window weighs megabytes, as real windows do", () => {
    // The headline regression: under the old fixture this was a fixed ~184 KB.
    const rng = mulberry32(0x5eed)
    const window = Array.from({ length: 200 }, (_, i) =>
      makeSizedEntry(i, sampleEntryBytes(rng), rng),
    )
    expect(JSON.stringify(window).length).toBeGreaterThan(1_000_000)
  })
})
