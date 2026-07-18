import { describe, expect, test } from "bun:test"
import {
  maxClaudeContextWindowFromModelUsage,
  normalizeClaudeUsageSnapshot,
  parseConfiguredContextWindowFromModelId,
  resolveFinalTurnUsage,
} from "./claude-usage-math"

// ---------------------------------------------------------------------------
// normalizeClaudeUsageSnapshot
// ---------------------------------------------------------------------------

describe("normalizeClaudeUsageSnapshot", () => {
  test("returns null for null input", () => {
    expect(normalizeClaudeUsageSnapshot(null)).toBeNull()
  })

  test("returns null for empty object (zero usedTokens)", () => {
    expect(normalizeClaudeUsageSnapshot({})).toBeNull()
  })

  test("returns null for non-record input", () => {
    expect(normalizeClaudeUsageSnapshot("string")).toBeNull()
    expect(normalizeClaudeUsageSnapshot(42)).toBeNull()
  })

  test("normalizes basic input/output tokens", () => {
    const result = normalizeClaudeUsageSnapshot({
      input_tokens: 100,
      output_tokens: 50,
    })
    expect(result).not.toBeNull()
    expect(result!.usedTokens).toBe(150)
    expect(result!.inputTokens).toBe(100)
    expect(result!.outputTokens).toBe(50)
  })

  test("accepts camelCase field names", () => {
    const result = normalizeClaudeUsageSnapshot({
      inputTokens: 200,
      outputTokens: 80,
    })
    expect(result).not.toBeNull()
    expect(result!.usedTokens).toBe(280)
    expect(result!.inputTokens).toBe(200)
  })

  test("includes cachedInputTokens when cache_read_input_tokens > 0", () => {
    const result = normalizeClaudeUsageSnapshot({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 30,
    })
    expect(result).not.toBeNull()
    // usedTokens includes cached tokens (which are part of total input)
    expect(result!.cachedInputTokens).toBe(30)
  })

  test("passes maxTokens through when provided and positive", () => {
    const result = normalizeClaudeUsageSnapshot(
      { input_tokens: 500, output_tokens: 100 },
      200_000,
    )
    expect(result).not.toBeNull()
    expect(result!.maxTokens).toBe(200_000)
  })

  test("omits maxTokens when not provided", () => {
    const result = normalizeClaudeUsageSnapshot({ input_tokens: 500, output_tokens: 100 })
    expect(result).not.toBeNull()
    expect(result!.maxTokens).toBeUndefined()
  })

  test("includes reasoningOutputTokens when provided", () => {
    const result = normalizeClaudeUsageSnapshot({
      input_tokens: 100,
      output_tokens: 50,
      reasoning_output_tokens: 20,
    })
    expect(result).not.toBeNull()
    expect(result!.reasoningOutputTokens).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// resolveFinalTurnUsage
// ---------------------------------------------------------------------------

describe("resolveFinalTurnUsage", () => {
  test("returns null when latestUsageSnapshot is null", () => {
    expect(resolveFinalTurnUsage(null, null, undefined)).toBeNull()
    expect(resolveFinalTurnUsage(null, normalizeClaudeUsageSnapshot({ input_tokens: 100, output_tokens: 10 }), 200_000)).toBeNull()
  })

  test("propagates maxTokens from lastKnownContextWindow", () => {
    const live = normalizeClaudeUsageSnapshot({ input_tokens: 100, output_tokens: 50 })!
    const result = resolveFinalTurnUsage(live, null, 200_000)
    expect(result!.maxTokens).toBe(200_000)
  })

  test("enriches totalProcessedTokens when accumulated > live usedTokens", () => {
    const live = normalizeClaudeUsageSnapshot({ input_tokens: 100, output_tokens: 50 })!
    const accumulated = normalizeClaudeUsageSnapshot({ input_tokens: 500, output_tokens: 50 })!
    expect(accumulated.usedTokens).toBeGreaterThan(live.usedTokens)

    const result = resolveFinalTurnUsage(live, accumulated, undefined)
    expect(result!.totalProcessedTokens).toBe(accumulated.usedTokens)
  })

  test("does NOT enrich totalProcessedTokens when accumulated <= live usedTokens", () => {
    const live = normalizeClaudeUsageSnapshot({ input_tokens: 500, output_tokens: 50 })!
    const accumulated = normalizeClaudeUsageSnapshot({ input_tokens: 100, output_tokens: 20 })!
    expect(accumulated.usedTokens).toBeLessThanOrEqual(live.usedTokens)

    const result = resolveFinalTurnUsage(live, accumulated, undefined)
    expect(result!.totalProcessedTokens).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// maxClaudeContextWindowFromModelUsage
// ---------------------------------------------------------------------------

describe("maxClaudeContextWindowFromModelUsage", () => {
  test("returns undefined for null", () => {
    expect(maxClaudeContextWindowFromModelUsage(null)).toBeUndefined()
  })

  test("returns undefined for non-record input", () => {
    expect(maxClaudeContextWindowFromModelUsage("string")).toBeUndefined()
    expect(maxClaudeContextWindowFromModelUsage(42)).toBeUndefined()
  })

  test("returns undefined for empty object", () => {
    expect(maxClaudeContextWindowFromModelUsage({})).toBeUndefined()
  })

  test("returns max contextWindow across multiple models", () => {
    const modelUsage = {
      "claude-opus": { contextWindow: 200_000, inputTokens: 100 },
      "claude-sonnet": { context_window: 1_000_000, inputTokens: 200 },
    }
    expect(maxClaudeContextWindowFromModelUsage(modelUsage)).toBe(1_000_000)
  })

  test("accepts context_window (snake_case) field name", () => {
    const modelUsage = {
      model: { context_window: 150_000 },
    }
    expect(maxClaudeContextWindowFromModelUsage(modelUsage)).toBe(150_000)
  })
})

// ---------------------------------------------------------------------------
// parseConfiguredContextWindowFromModelId
// ---------------------------------------------------------------------------

describe("parseConfiguredContextWindowFromModelId", () => {
  test("returns 1_000_000 for model ids ending with [1m]", () => {
    expect(parseConfiguredContextWindowFromModelId("claude-opus-4-6[1m]")).toBe(1_000_000)
    expect(parseConfiguredContextWindowFromModelId("claude-sonnet-4-7[1m]")).toBe(1_000_000)
  })

  test("returns undefined for model ids without [1m] suffix", () => {
    expect(parseConfiguredContextWindowFromModelId("claude-opus-4-6")).toBeUndefined()
    expect(parseConfiguredContextWindowFromModelId("claude-sonnet-4-7")).toBeUndefined()
    expect(parseConfiguredContextWindowFromModelId("")).toBeUndefined()
  })
})
