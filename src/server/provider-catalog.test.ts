import { describe, expect, test } from "bun:test"
import {
  codexServiceTierFromModelOptions,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
  isClaudeSdkProvider,
  openrouterAuthReady,
  getServerProviderCatalog,
} from "./provider-catalog"
import { resolveClaudeApiModelId } from "../shared/types"
import type { LlmProviderSnapshot } from "../shared/types"

describe("provider catalog normalization", () => {
  test("maps legacy Claude effort into shared model options", () => {
    expect(normalizeClaudeModelOptions("claude-opus-4-7", undefined, "max")).toEqual({
      reasoningEffort: "max",
      contextWindow: "200k",
    })
  })

  test("normalizes Claude context window only for supported models", () => {
    expect(normalizeClaudeModelOptions("claude-sonnet-4-6", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toEqual({
      reasoningEffort: "medium",
      contextWindow: "1m",
    })

    expect(normalizeClaudeModelOptions("claude-haiku-4-5-20251001", {
      claude: {
        reasoningEffort: "medium",
        contextWindow: "1m",
      },
    })).toMatchObject({
      reasoningEffort: "medium",
    })
  })

  test("normalizes Codex model options and fast mode defaults", () => {
    expect(normalizeCodexModelOptions(undefined)).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    })

    const normalized = normalizeCodexModelOptions({
      codex: {
        reasoningEffort: "xhigh",
        fastMode: true,
      },
    })

    expect(normalized).toEqual({
      reasoningEffort: "xhigh",
      fastMode: true,
    })
    expect(codexServiceTierFromModelOptions(normalized)).toBe("fast")
  })

  test("normalizes server model ids through the shared alias catalog", () => {
    expect(normalizeServerModel("codex")).toBe("gpt-5.5")
    expect(normalizeServerModel("claude", "opus")).toBe("claude-opus-4-7")
    expect(normalizeServerModel("codex", "gpt-5-codex")).toBe("gpt-5.3-codex")
  })

  test("resolves Claude API model ids for 1m context window", () => {
    expect(resolveClaudeApiModelId("claude-opus-4-7", "1m")).toBe("claude-opus-4-7[1m]")
    expect(resolveClaudeApiModelId("claude-sonnet-4-6", "200k")).toBe("claude-sonnet-4-6")
  })
})

describe("isClaudeSdkProvider", () => {
  test("claude and openrouter use the Claude SDK path; codex does not", () => {
    expect(isClaudeSdkProvider("claude")).toBe(true)
    expect(isClaudeSdkProvider("openrouter")).toBe(true)
    expect(isClaudeSdkProvider("codex")).toBe(false)
  })
  test("openrouter server catalog entry exists", () => {
    expect(getServerProviderCatalog("openrouter").id).toBe("openrouter")
  })
})

describe("openrouterAuthReady", () => {
  const base = { provider: "openrouter", apiKey: "sk-or-x", enabled: true } as unknown as LlmProviderSnapshot
  test("true when openrouter snapshot enabled with a key", () => {
    expect(openrouterAuthReady(base)).toBe(true)
  })
  test("false when disabled", () => {
    expect(openrouterAuthReady({ ...base, enabled: false } as LlmProviderSnapshot)).toBe(false)
  })
  test("false when key empty", () => {
    expect(openrouterAuthReady({ ...base, apiKey: "" } as LlmProviderSnapshot)).toBe(false)
  })
  test("false when provider is not openrouter", () => {
    expect(openrouterAuthReady({ ...base, provider: "openai" } as LlmProviderSnapshot)).toBe(false)
  })
})
