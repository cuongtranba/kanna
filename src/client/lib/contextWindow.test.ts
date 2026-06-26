import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import {
  computeSessionTotals,
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  formatCostUsd,
  overrideContextWindowMaxTokens,
} from "./contextWindow"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function entry(
  partial: DistributiveOmit<TranscriptEntry, "_id" | "createdAt">,
  createdAt = Date.now(),
): TranscriptEntry {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...partial,
  } as TranscriptEntry
}

describe("deriveLatestContextWindowSnapshot", () => {
  test("derives the latest valid snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      entry({ kind: "context_window_updated", usage: { usedTokens: 0, compactsAutomatically: false } }, 1),
      entry({ kind: "context_window_updated", usage: { usedTokens: 125, maxTokens: 500, compactsAutomatically: false } }, 2),
    ])

    expect(snapshot).not.toBeNull()
    expect(snapshot?.usedTokens).toBe(125)
    expect(snapshot?.maxTokens).toBe(500)
    expect(snapshot?.usedPercentage).toBe(25)
    expect(snapshot?.remainingTokens).toBe(375)
  })

  test("marks snapshots as compaction-capable when the chat contains compaction signals", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      entry({ kind: "compact_boundary" }, 1),
      entry({ kind: "context_window_updated", usage: { usedTokens: 321, compactsAutomatically: false } }, 2),
    ])

    expect(snapshot?.compactsAutomatically).toBe(true)
  })
})

describe("formatContextWindowTokens", () => {
  test("formats raw and abbreviated token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999")
    expect(formatContextWindowTokens(1400)).toBe("1.4k")
    expect(formatContextWindowTokens(14_000)).toBe("14k")
    expect(formatContextWindowTokens(1_400_000)).toBe("1.4m")
  })
})

describe("overrideContextWindowMaxTokens", () => {
  test("recomputes denominator-dependent fields with a staged max token value", () => {
    const base = deriveLatestContextWindowSnapshot([
      entry({ kind: "context_window_updated", usage: { usedTokens: 50_000, maxTokens: 200_000, compactsAutomatically: false } }),
    ])

    const overridden = overrideContextWindowMaxTokens(base, 1_000_000)

    expect(overridden?.maxTokens).toBe(1_000_000)
    expect(overridden?.usedPercentage).toBe(5)
    expect(overridden?.remainingTokens).toBe(950_000)
  })
})

describe("computeSessionTotals", () => {
  test("sums per-turn result entries + subagent usage + cost", () => {
    const entries = [
      { kind: "context_window_updated", createdAt: 1, usage: { usedTokens: 5000, lastInputTokens: 5000, compactsAutomatically: false } },
      { kind: "result", createdAt: 2, subtype: "success", isError: false, durationMs: 1, result: "", usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10, costUsd: 0.01 }, costUsd: 0.01 },
      { kind: "result", createdAt: 3, subtype: "success", isError: false, durationMs: 1, result: "", usage: { inputTokens: 150, outputTokens: 30 }, costUsd: 0.02 },
    ] as never
    const subagentRuns = [
      { usage: { inputTokens: 40, outputTokens: 10, cachedInputTokens: 5, costUsd: 0.005 } },
    ] as never
    const totals = computeSessionTotals(entries, subagentRuns)
    expect(totals?.inputTokens).toBe(290)   // 100 + 150 + 40
    expect(totals?.outputTokens).toBe(60)   // 20 + 30 + 10
    expect(totals?.cachedTokens).toBe(15)   // 10 + 0 + 5
    expect(totals?.costUsd).toBeCloseTo(0.035, 6) // 0.01 + 0.02 + 0.005
  })

  test("ignores context_window_updated entries (no double count)", () => {
    const entries = [
      { kind: "context_window_updated", createdAt: 1, usage: { usedTokens: 9999, lastInputTokens: 9999, compactsAutomatically: false } },
    ] as never
    expect(computeSessionTotals(entries, [] as never)).toBeNull()
  })

  test("returns null when nothing accumulated", () => {
    expect(computeSessionTotals([] as never, [] as never)).toBeNull()
  })

  test("reads cost from result.costUsd when usage.costUsd absent", () => {
    const entries = [
      { kind: "result", createdAt: 1, subtype: "success", isError: false, durationMs: 1, result: "", usage: { inputTokens: 100, outputTokens: 20 }, costUsd: 0.03 },
    ] as never
    const totals = computeSessionTotals(entries, [] as never)
    expect(totals?.costUsd).toBeCloseTo(0.03, 6)
  })
})

describe("formatCostUsd", () => {
  test("formats sub-cent and dollars", () => {
    expect(formatCostUsd(0)).toBe("$0.00")
    expect(formatCostUsd(0.004)).toBe("<$0.01")
    expect(formatCostUsd(0.42)).toBe("$0.42")
    expect(formatCostUsd(12.3)).toBe("$12.30")
  })
})
