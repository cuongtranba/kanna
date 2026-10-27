import { describe, expect, test } from "bun:test"
import {
  DEFAULT_OPENAI_SDK_MODEL,
  DEFAULT_OPENROUTER_SDK_MODEL,
} from "../../shared/types"
import {
  createLlmProviderDraftForSelection,
  getDefaultLlmProviderModel,
} from "./llmProviderDraft"

describe("quick response provider draft", () => {
  test("resets provider model ids to the selected provider default", () => {
    expect(getDefaultLlmProviderModel("openai")).toBe(DEFAULT_OPENAI_SDK_MODEL)
    expect(getDefaultLlmProviderModel("openrouter")).toBe(DEFAULT_OPENROUTER_SDK_MODEL)
    expect(getDefaultLlmProviderModel("custom")).toBe("")
  })

  test("switching quick response providers does not keep stale model ids", () => {
    const current = {
      provider: "openrouter" as const,
      apiKey: "sk-example",
      model: "anthropic/claude-opus-4.1",
      baseUrl: "https://custom.example/v1",
    }

    expect(createLlmProviderDraftForSelection(current, "openai")).toEqual({
      provider: "openai",
      apiKey: "sk-example",
      model: DEFAULT_OPENAI_SDK_MODEL,
      baseUrl: "",
    })

    expect(createLlmProviderDraftForSelection(current, "custom")).toEqual({
      provider: "custom",
      apiKey: "sk-example",
      model: "",
      baseUrl: "https://custom.example/v1",
    })
  })
})
