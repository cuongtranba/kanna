import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  getAutoCompactPctOverride,
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

  test("1M context window threshold matches upstream ry8(): window - 20k - 13k", () => {
    expect(getAutoCompactThreshold(1_000_000))
      .toBe(1_000_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY - AUTOCOMPACT_BUFFER_TOKENS)
  })
})

describe("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", () => {
  test("unset → undefined", () => {
    expect(getAutoCompactPctOverride({})).toBeUndefined()
  })

  test("non-numeric / out-of-range → undefined (mirrors upstream guard)", () => {
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "abc" })).toBeUndefined()
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "0" })).toBeUndefined()
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "-5" })).toBeUndefined()
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "101" })).toBeUndefined()
  })

  test("valid pct parsed", () => {
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "70" })).toBe(70)
    expect(getAutoCompactPctOverride({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "100" })).toBe(100)
  })

  test("pct override caps below default threshold (upstream Math.min)", () => {
    // 200k window: default threshold = 167_000. pct=70 of 180_000 effective = 126_000.
    // min(126_000, 167_000) = 126_000.
    const env = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "70" }
    expect(getAutoCompactThreshold(200_000, MAX_OUTPUT_TOKENS_FOR_SUMMARY, env))
      .toBe(Math.floor(180_000 * 0.7))
  })

  test("pct=100 yields the default threshold (override can only lower)", () => {
    const env = { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "100" }
    expect(getAutoCompactThreshold(200_000, MAX_OUTPUT_TOKENS_FOR_SUMMARY, env))
      .toBe(getAutoCompactThreshold(200_000, MAX_OUTPUT_TOKENS_FOR_SUMMARY, {}))
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

  test("1M window: 200k used is well below threshold (regression for SDK#238)", () => {
    // Pre-fix: SDK reported contextWindow=200_000 even on 1m beta → threshold=167k
    // → compacted at ~17% of real 1M window. With maxTokens correctly seeded
    // from the [1m] model id, 200k used is far below the 967k threshold.
    expect(
      shouldProactivelyCompact({ usedTokens: 200_000, maxTokens: 1_000_000 }),
    ).toBe(false)
  })

  test("1M window: fires at correct upstream threshold", () => {
    const threshold = getAutoCompactThreshold(1_000_000)
    expect(
      shouldProactivelyCompact({ usedTokens: threshold, maxTokens: 1_000_000 }),
    ).toBe(true)
    expect(
      shouldProactivelyCompact({ usedTokens: threshold - 1, maxTokens: 1_000_000 }),
    ).toBe(false)
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

// Upstream-sync lock. These constants are hand-mirrored from
// anthropics/claude-code src/services/compact/autoCompact.ts. If upstream
// changes them, Kanna's proactive trigger silently drifts from the CLI's
// real auto-compact point. This test fails on any local edit, forcing a
// conscious re-check against upstream before the value can move.
describe("upstream constant pins", () => {
  test("MAX_OUTPUT_TOKENS_FOR_SUMMARY matches upstream", () => {
    expect(MAX_OUTPUT_TOKENS_FOR_SUMMARY).toBe(20_000)
  })

  test("AUTOCOMPACT_BUFFER_TOKENS matches upstream", () => {
    expect(AUTOCOMPACT_BUFFER_TOKENS).toBe(13_000)
  })

  test("MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES matches upstream", () => {
    expect(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES).toBe(3)
  })
})

// Cache-token misfire guard. The trigger keys off the snapshot's
// `usedTokens` (the real in-context size). Prompt-cache growth surfaces in
// `cachedInputTokens`, NOT `usedTokens`, so a cache-heavy turn must never
// trip a compact on its own; only true context growth may.
describe("cache tokens do not drive the trigger", () => {
  test("huge cachedInputTokens with low usedTokens does NOT trigger", () => {
    const usage = {
      usedTokens: 10_000,
      maxTokens: 200_000,
      cachedInputTokens: 950_000,
      compactsAutomatically: false,
    }
    expect(shouldProactivelyCompact(usage)).toBe(false)
  })

  test("usedTokens above threshold triggers regardless of cache size", () => {
    const usage = {
      usedTokens: 180_000,
      maxTokens: 200_000,
      cachedInputTokens: 0,
      compactsAutomatically: false,
    }
    expect(shouldProactivelyCompact(usage)).toBe(true)
  })
})
