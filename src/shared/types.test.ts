import { describe, expect, test } from "bun:test"
import {
  normalizeClaudeModelId,
  normalizeCodexModelId,
  supportsClaudeMaxReasoningEffort,
  DEFAULT_KEYBINDINGS,
  KEYBINDING_ACTIONS,
  type KeybindingAction,
  PROVIDERS,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS_URL,
  DEFAULT_OPENROUTER_SDK_MODEL,
  mergeCustomModels,
  effectiveContextWindowOptions,
  type CustomModelEntry,
} from "./types"

describe("keybinding registration", () => {
  test("KEYBINDING_ACTIONS lists every action in DEFAULT_KEYBINDINGS", () => {
    expect([...KEYBINDING_ACTIONS].sort()).toEqual(
      Object.keys(DEFAULT_KEYBINDINGS).sort() as KeybindingAction[],
    )
  })

  test("no two actions claim the same default binding", () => {
    const bindings = Object.values(DEFAULT_KEYBINDINGS).flat()
    expect(bindings).toEqual([...new Set(bindings)])
  })
})

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
    expect(supportsClaudeMaxReasoningEffort("claude-sonnet-4-6")).toBe(true)
    expect(supportsClaudeMaxReasoningEffort("claude-haiku-4-5-20251001")).toBe(false)
  })

  test("preserves a known custom model id instead of collapsing to default", () => {
    const custom: CustomModelEntry[] = [{
      id: "sonnet-5",
      label: "Sonnet 5",
      provider: "claude",
      createdAt: 1,
      updatedAt: 1,
    }]
    expect(normalizeClaudeModelId("sonnet-5", undefined, custom)).toBe("sonnet-5")
    expect(normalizeCodexModelId("gpt-x", undefined, [{
      id: "gpt-x",
      label: "GPT X",
      provider: "codex",
      createdAt: 1,
      updatedAt: 1,
    }])).toBe("gpt-x")
  })

  test("supportsClaudeMaxReasoningEffort honors custom-model metadata", () => {
    const custom: CustomModelEntry[] = [{
      id: "sonnet-5",
      label: "Sonnet 5",
      provider: "claude",
      supportedEfforts: ["low", "medium", "high", "max"],
      createdAt: 1,
      updatedAt: 1,
    }]
    expect(supportsClaudeMaxReasoningEffort("sonnet-5", custom)).toBe(true)
    expect(supportsClaudeMaxReasoningEffort("claude-haiku-4-5-20251001")).toBe(false)
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

  test("an override inherits optional fields the custom entry omits", () => {
    const builtin = PROVIDERS.find((p) => p.id === "claude")!.models.find((m) => m.id === "claude-opus-5")!
    expect(builtin.contextWindowOptions?.some((o) => o.id === "1m")).toBe(true)

    const merged = mergeCustomModels(base(), [entry({ id: "claude-opus-5", label: "Opus 5" })])
    const opus = merged.find((p) => p.id === "claude")!.models.find((m) => m.id === "claude-opus-5")!
    expect(opus.label).toBe("Opus 5")
    expect(opus.contextWindowOptions).toEqual(builtin.contextWindowOptions)
    expect(opus.supportedEfforts).toEqual(builtin.supportedEfforts)
  })

  test("an override still wins for the fields it does declare", () => {
    const merged = mergeCustomModels(base(), [
      entry({ id: "claude-opus-5", label: "Opus 5", contextWindowOptions: [{ id: "200k", label: "200k" }] }),
    ])
    const opus = merged.find((p) => p.id === "claude")!.models.find((m) => m.id === "claude-opus-5")!
    expect(opus.contextWindowOptions).toEqual([{ id: "200k", label: "200k" }])
  })

  test("a brand-new model inherits nothing", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "claude-unheard-of", label: "Unheard Of" })])
    const model = merged.find((p) => p.id === "claude")!.models.find((m) => m.id === "claude-unheard-of")!
    expect(model.contextWindowOptions).toBeUndefined()
    expect(model.supportedEfforts).toBeUndefined()
  })

  test("effectiveContextWindowOptions agrees with what mergeCustomModels resolves", () => {
    for (const id of ["claude-opus-5", "claude-haiku-4-5-20251001"]) {
      const merged = mergeCustomModels(base(), [entry({ id, label: "Renamed" })])
      const resolved = merged.find((p) => p.id === "claude")!.models.find((m) => m.id === id)!
      expect(effectiveContextWindowOptions("claude", id, undefined))
        .toEqual(resolved.contextWindowOptions ?? [])
    }
  })

  test("effectiveContextWindowOptions prefers what the entry declares", () => {
    expect(effectiveContextWindowOptions("claude", "claude-opus-5", [{ id: "200k", label: "200k" }]))
      .toEqual([{ id: "200k", label: "200k" }])
    expect(effectiveContextWindowOptions("claude", "not-a-real-model", undefined)).toEqual([])
  })

  test("routes codex entries to the codex provider only", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "gpt-x", label: "GPT X", provider: "codex" })])
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
