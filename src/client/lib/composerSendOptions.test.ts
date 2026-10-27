import { describe, expect, test } from "bun:test"
import type { ComposerState } from "../stores/chatPreferencesStore"
import { fromSendOptions, toSendOptions } from "./composerSendOptions"

const CLAUDE_STATE: ComposerState = {
  provider: "claude",
  model: "opus",
  modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
  planMode: true,
}

const CODEX_STATE: ComposerState = {
  provider: "codex",
  model: "gpt-5",
  modelOptions: { reasoningEffort: "low", fastMode: true },
  planMode: false,
}

describe("toSendOptions", () => {
  test("nests provider model options under the provider key", () => {
    expect(toSendOptions(CLAUDE_STATE, true)).toEqual({
      provider: "claude",
      model: "opus",
      modelOptions: { claude: { reasoningEffort: "max", contextWindow: "1m" } },
      planMode: true,
    })
    expect(toSendOptions(CODEX_STATE, true).modelOptions).toEqual({ codex: { reasoningEffort: "low", fastMode: true } })
  })

  test("sends no model options for endpoint providers", () => {
    const state: ComposerState = { provider: "openrouter", model: "vendor/model", modelOptions: {}, planMode: false }
    expect(toSendOptions(state, false).modelOptions).toEqual({})
  })

  test("forces plan mode off when the provider does not support it", () => {
    expect(toSendOptions(CLAUDE_STATE, false).planMode).toBe(false)
  })
})

describe("fromSendOptions", () => {
  test("round-trips what toSendOptions produced", () => {
    expect(fromSendOptions(toSendOptions(CLAUDE_STATE, true))).toEqual(CLAUDE_STATE)
    expect(fromSendOptions(toSendOptions(CODEX_STATE, true))).toEqual(CODEX_STATE)
  })

  test("fills missing option fields from the shared defaults", () => {
    const claude = fromSendOptions({ provider: "claude", model: "opus", modelOptions: { claude: {} } })
    expect(claude?.modelOptions).toEqual({ reasoningEffort: "high", contextWindow: "200k" })
    const codex = fromSendOptions({ provider: "codex", model: "gpt-5", modelOptions: { codex: {} } })
    expect(codex?.modelOptions).toEqual({ reasoningEffort: "high", fastMode: false })
  })

  test("accepts endpoint providers without model options", () => {
    expect(fromSendOptions({ provider: "custom", model: "acme/m" })).toEqual({
      provider: "custom",
      model: "acme/m",
      modelOptions: {},
      planMode: false,
    })
  })

  test("returns null when provider or model is missing", () => {
    expect(fromSendOptions(undefined)).toBeNull()
    expect(fromSendOptions({ provider: "claude" })).toBeNull()
    expect(fromSendOptions({ model: "opus" })).toBeNull()
  })

  test("returns null for a built-in provider without its model options", () => {
    expect(fromSendOptions({ provider: "claude", model: "opus" })).toBeNull()
  })
})
