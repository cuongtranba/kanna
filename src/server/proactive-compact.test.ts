import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  getAutoCompactThreshold,
  getEffectiveContextWindow,
  getLatestContextWindowUsage,
  shouldProactivelyCompact,
} from "./proactive-compact"

const usageEntry = (usedTokens: number, maxTokens: number, createdAt = 0): TranscriptEntry => ({
  _id: `u-${createdAt}`,
  createdAt,
  kind: "context_window_updated",
  usage: { usedTokens, maxTokens, compactsAutomatically: false },
} as TranscriptEntry)

const compactBoundary = (createdAt = 0): TranscriptEntry => ({
  _id: `cb-${createdAt}`,
  createdAt,
  kind: "compact_boundary",
} as TranscriptEntry)

describe("proactive-compact thresholds", () => {
  test("effective window subtracts the reserved summary tokens", () => {
    expect(getEffectiveContextWindow(200_000)).toBe(200_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY)
  })

  test("reserved is capped at MAX_OUTPUT_TOKENS_FOR_SUMMARY", () => {
    expect(getEffectiveContextWindow(200_000, 64_000)).toBe(200_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY)
    expect(getEffectiveContextWindow(200_000, 4_000)).toBe(200_000 - 4_000)
  })

  test("autocompact threshold = effective - 13k buffer", () => {
    expect(getAutoCompactThreshold(200_000))
      .toBe(200_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY - AUTOCOMPACT_BUFFER_TOKENS)
  })

  test("never returns negative", () => {
    expect(getEffectiveContextWindow(5_000)).toBe(0)
    expect(getAutoCompactThreshold(5_000)).toBe(0)
  })
})

describe("shouldProactivelyCompact", () => {
  test("returns false when usage is null", () => {
    expect(shouldProactivelyCompact(null)).toBe(false)
  })

  test("returns false when below threshold", () => {
    expect(
      shouldProactivelyCompact({ usedTokens: 100_000, maxTokens: 200_000 }),
    ).toBe(false)
  })

  test("returns true at the threshold boundary", () => {
    const threshold = getAutoCompactThreshold(200_000)
    expect(
      shouldProactivelyCompact({ usedTokens: threshold, maxTokens: 200_000 }),
    ).toBe(true)
  })

  test("returns true above threshold", () => {
    expect(
      shouldProactivelyCompact({ usedTokens: 180_000, maxTokens: 200_000 }),
    ).toBe(true)
  })

  test("returns false when maxTokens missing or zero", () => {
    expect(shouldProactivelyCompact({ usedTokens: 180_000, maxTokens: 0 })).toBe(false)
    expect(shouldProactivelyCompact({ usedTokens: 180_000 } as never)).toBe(false)
  })

  test("returns false when usedTokens missing or zero", () => {
    expect(shouldProactivelyCompact({ usedTokens: 0, maxTokens: 200_000 })).toBe(false)
  })
})

describe("getLatestContextWindowUsage", () => {
  test("returns null on empty transcript", () => {
    expect(getLatestContextWindowUsage([])).toBe(null)
  })

  test("returns the latest context_window_updated usage", () => {
    const messages = [
      usageEntry(50_000, 200_000, 1),
      usageEntry(120_000, 200_000, 2),
      usageEntry(180_000, 200_000, 3),
    ]
    expect(getLatestContextWindowUsage(messages)?.usedTokens).toBe(180_000)
  })

  test("returns null when a more recent compact_boundary precedes any usage", () => {
    // A boundary between earlier usage and now means context was compacted —
    // we must not trigger another compact off the pre-compaction usage entry.
    const messages = [
      usageEntry(180_000, 200_000, 1),
      compactBoundary(2),
    ]
    expect(getLatestContextWindowUsage(messages)).toBe(null)
  })

  test("returns usage that landed AFTER a compact_boundary", () => {
    const messages = [
      usageEntry(180_000, 200_000, 1),
      compactBoundary(2),
      usageEntry(40_000, 200_000, 3),
    ]
    expect(getLatestContextWindowUsage(messages)?.usedTokens).toBe(40_000)
  })
})
