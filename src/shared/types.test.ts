import { describe, expect, test } from "bun:test"
import {
  normalizeClaudeModelId,
  normalizeCodexModelId,
  supportsClaudeMaxReasoningEffort,
  PROVIDERS,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS_URL,
  DEFAULT_OPENROUTER_SDK_MODEL,
} from "./types"

describe("shared model normalization", () => {
  test("normalizes Claude aliases via the provider catalog", () => {
    expect(normalizeClaudeModelId("opus")).toBe("claude-opus-4-7")
    expect(normalizeClaudeModelId("sonnet")).toBe("claude-sonnet-4-6")
    expect(normalizeClaudeModelId("haiku")).toBe("claude-haiku-4-5-20251001")
  })

  test("normalizes legacy Codex aliases and defaults to the latest catalog model", () => {
    expect(normalizeCodexModelId()).toBe("gpt-5.5")
    expect(normalizeCodexModelId("gpt-5-codex")).toBe("gpt-5.3-codex")
  })

  test("uses declarative metadata for Claude max-effort support", () => {
    expect(supportsClaudeMaxReasoningEffort("claude-opus-4-7")).toBe(true)
    expect(supportsClaudeMaxReasoningEffort("opus")).toBe(true)
    expect(supportsClaudeMaxReasoningEffort("claude-sonnet-4-6")).toBe(false)
  })
})

describe("openrouter provider", () => {
  test("openrouter is a known provider with a default model and empty static models", () => {
    const entry = PROVIDERS.find((p) => p.id === "openrouter")
    expect(entry).toBeDefined()
    expect(entry?.defaultModel).toBe(DEFAULT_OPENROUTER_SDK_MODEL)
    expect(entry?.models).toEqual([])
    expect(entry?.supportsPlanMode).toBe(true)
  })
  test("openrouter endpoints are defined", () => {
    expect(OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api")
    expect(OPENROUTER_MODELS_URL).toBe("https://openrouter.ai/api/v1/models")
  })
})
