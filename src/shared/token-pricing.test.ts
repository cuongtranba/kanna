import { describe, expect, test } from "bun:test"
import { computeCostUsd, resolveModelPrice } from "./token-pricing"

describe("computeCostUsd", () => {
  test("sums input+output at per-MTok rates", () => {
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { inputPerMTok: 3, outputPerMTok: 15 },
    )
    expect(cost).toBeCloseTo(18, 6)
  })

  test("cached tokens use cachedInputPerMTok when present", () => {
    const cost = computeCostUsd(
      { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
    )
    expect(cost).toBeCloseTo(0.3, 6)
  })

  test("cached tokens fall back to input rate when no cached rate", () => {
    const cost = computeCostUsd(
      { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15 },
    )
    expect(cost).toBeCloseTo(3, 6)
  })

  test("missing fields treated as zero", () => {
    expect(computeCostUsd({}, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(0)
  })
})

describe("resolveModelPrice", () => {
  test("derives OpenRouter price from per-token model pricing (x1e6)", () => {
    const price = resolveModelPrice("anthropic/claude-sonnet-4", {
      promptPerTok: 0.000003,
      completionPerTok: 0.000015,
    })
    expect(price).toEqual({ inputPerMTok: 3, outputPerMTok: 15 })
  })

  test("uses built-in table for a known static model id", () => {
    const price = resolveModelPrice("claude-sonnet-4-6")
    expect(price?.inputPerMTok).toBeGreaterThan(0)
    expect(price?.outputPerMTok).toBeGreaterThan(0)
  })

  test("unknown model id returns null (never fabricate)", () => {
    expect(resolveModelPrice("totally-unknown-model")).toBeNull()
  })
})
