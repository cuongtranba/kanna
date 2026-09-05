import { describe, expect, test } from "bun:test"
import {
  billedUsageOfResult,
  computeCostUsd,
  resolveModelPrice,
  splitBilledTokens,
  stripModelVariantSuffix,
} from "./token-pricing"

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
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
    )
    expect(cost).toBeCloseTo(2.46, 6)
  })
})

describe("splitBilledTokens", () => {
  test("subtracts cached reads from input so the kinds partition", () => {
    expect(splitBilledTokens({
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 50_000,
    })).toEqual([
      ["input", 800_000],
      ["cached_input", 200_000],
      ["output", 50_000],
    ])
  })

  test("the split sums to the tokens actually billed, never more", () => {
    const usage = { inputTokens: 900, cachedInputTokens: 400, outputTokens: 100 }
    const total = splitBilledTokens(usage).reduce((sum, [, count]) => sum + count, 0)
    expect(total).toBe(1_000)
  })

  test("omits kinds with nothing to report rather than emitting zeros", () => {
    expect(splitBilledTokens({ outputTokens: 12 })).toEqual([["output", 12]])
    expect(splitBilledTokens({})).toEqual([])
  })

  test("never yields a negative count when cached exceeds input", () => {
    expect(splitBilledTokens({ inputTokens: 100, cachedInputTokens: 500 })).toEqual([
      ["cached_input", 500],
    ])
  })

  test("ignores non-finite and negative provider values", () => {
    expect(splitBilledTokens({
      inputTokens: Number.NaN,
      outputTokens: -5,
      cachedInputTokens: Number.POSITIVE_INFINITY,
    })).toEqual([])
  })
})

describe("billedUsageOfResult", () => {
  test("prefers the entry-level cost over the one inside usage", () => {
    expect(billedUsageOfResult({
      usage: { inputTokens: 10, costUsd: 0.9 },
      costUsd: 0.25,
    })).toEqual({ inputTokens: 10, costUsd: 0.25 })
  })

  test("falls back to the cost inside usage", () => {
    expect(billedUsageOfResult({ usage: { inputTokens: 10, costUsd: 0.5 } }))
      .toEqual({ inputTokens: 10, costUsd: 0.5 })
  })

  test("keeps token counts when no cost was reported at all", () => {
    expect(billedUsageOfResult({ usage: { inputTokens: 10 } })).toEqual({ inputTokens: 10 })
  })

  test("carries a cost that arrived with no token counts", () => {
    expect(billedUsageOfResult({ costUsd: 0.25 })).toEqual({ costUsd: 0.25 })
  })

  test("returns undefined when the entry reported neither", () => {
    expect(billedUsageOfResult({})).toBeUndefined()
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

  test("OpenRouter free model (0/0) returns zero price, not a static fallback", () => {
    expect(resolveModelPrice("some/free-model", { promptPerTok: 0, completionPerTok: 0 })).toEqual({
      inputPerMTok: 0,
      outputPerMTok: 0,
    })
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

describe("stripModelVariantSuffix", () => {
  test("strips an OpenRouter routing variant suffix", () => {
    expect(stripModelVariantSuffix("moonshotai/kimi-k2.5:nitro")).toBe("moonshotai/kimi-k2.5")
    expect(stripModelVariantSuffix("openai/gpt-5:floor")).toBe("openai/gpt-5")
  })

  test("returns the id unchanged when there is no suffix", () => {
    expect(stripModelVariantSuffix("anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4")
  })
})
