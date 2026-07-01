import { describe, expect, test } from "bun:test"
import {
  normalizeClaudeModelId,
  normalizeCodexModelId,
  supportsClaudeMaxReasoningEffort,
  PROVIDERS,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS_URL,
  DEFAULT_OPENROUTER_SDK_MODEL,
  mergeCustomModels,
  type CustomModelEntry,
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

describe("mergeCustomModels", () => {
  const base = () => PROVIDERS.map((p) => ({ ...p, models: [...p.models] }))

  const entry = (over: Partial<CustomModelEntry>): CustomModelEntry => ({
    id: "custom-x",
    label: "Custom X",
    provider: "claude",
    supportsEffort: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

  test("appends a new model to the matching provider", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "claude-new", label: "New" })])
    const claude = merged.find((p) => p.id === "claude")!
    expect(claude.models.some((m) => m.id === "claude-new")).toBe(true)
  })

  test("overrides a built-in with the same id in place", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "claude-opus-4-8", label: "Renamed Opus" })])
    const claude = merged.find((p) => p.id === "claude")!
    const opus = claude.models.filter((m) => m.id === "claude-opus-4-8")
    expect(opus).toHaveLength(1)
    expect(opus[0]!.label).toBe("Renamed Opus")
  })

  test("routes codex entries to the codex provider only", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "gpt-x", label: "GPT X", provider: "codex", supportsEffort: false })])
    expect(merged.find((p) => p.id === "codex")!.models.some((m) => m.id === "gpt-x")).toBe(true)
    expect(merged.find((p) => p.id === "claude")!.models.some((m) => m.id === "gpt-x")).toBe(false)
  })

  test("empty custom list returns an equal catalog and does not mutate base", () => {
    const original = base()
    const merged = mergeCustomModels(original, [])
    expect(merged.find((p) => p.id === "claude")!.models.map((m) => m.id))
      .toEqual(original.find((p) => p.id === "claude")!.models.map((m) => m.id))
    expect(original.find((p) => p.id === "claude")!.models.length).toBeGreaterThan(0)
  })
})
