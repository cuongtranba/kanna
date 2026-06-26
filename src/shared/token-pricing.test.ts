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

  test("cached portion is not double-billed (input already includes cached)", () => {
    // 1M total input of which 200k are cache reads, sonnet-like rates
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
    )
    // 800k @ $3/M = 2.4 ; 200k @ $0.3/M = 0.06 ; total 2.46
    expect(cost).toBeCloseTo(2.46, 6)
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
    expect(resolveModelPrice("claude-sonnet-4-6")).toEqual({
      inputPerMTok: 3,
      outputPerMTok: 15,
      cachedInputPerMTok: 0.3,
    })
  })

  test("unknown model id returns null (never fabricate)", () => {
    expect(resolveModelPrice("totally-unknown-model")).toBeNull()
  })

  test("o4 needle does not match ids where o4 is part of a larger word", () => {
    expect(resolveModelPrice("acme/foo4bar")).toBeNull()
  })

  test("o4 needle matches openai/o4-mini", () => {
    expect(resolveModelPrice("openai/o4-mini")).toEqual({
      inputPerMTok: 1.1,
      outputPerMTok: 4.4,
    })
  })
})
