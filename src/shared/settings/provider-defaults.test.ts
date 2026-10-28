import { describe, expect, test } from "vite-plus/test"
import { AGENT_PROVIDERS } from "../core-types"
import {
  createDefaultProviderDefaults,
  normalizeClaudePreference,
  normalizeCodexPreference,
  normalizeDefaultProvider,
  normalizeProviderDefaults,
} from "./provider-defaults"

describe("normalizeDefaultProvider", () => {
  test("accepts every agent provider and last_used is the fallback", () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(normalizeDefaultProvider(provider)).toBe(provider)
    }
    expect(normalizeDefaultProvider("gemini")).toBe("last_used")
    expect(normalizeDefaultProvider(undefined)).toBe("last_used")
  })
})

describe("normalizeProviderDefaults", () => {
  test("an absent value normalizes to the defaults", () => {
    expect(normalizeProviderDefaults(undefined)).toEqual(createDefaultProviderDefaults())
  })

  test("the legacy effort field is used when modelOptions carries no valid effort", () => {
    expect(normalizeClaudePreference({ effort: "low", modelOptions: { reasoningEffort: "bogus" } }).modelOptions.reasoningEffort).toBe("low")
    expect(normalizeCodexPreference({ effort: "low" }).modelOptions.reasoningEffort).toBe("low")
  })

  test("planMode is only true for a literal true", () => {
    expect(normalizeClaudePreference({ planMode: true }).planMode).toBe(true)
    expect(normalizeCodexPreference({ planMode: false }).planMode).toBe(false)
    expect(normalizeProviderDefaults({ openrouter: { planMode: true } }).openrouter.planMode).toBe(true)
  })

  test("openrouter and custom coerce a truthy settings.json value with Boolean semantics", () => {
    const stored = JSON.parse('{"openrouter":{"planMode":1},"custom":{"planMode":"yes"}}')
    const normalized = normalizeProviderDefaults(stored)
    expect(normalized.openrouter.planMode).toBe(true)
    expect(normalized.custom.planMode).toBe(true)
  })
})
