import { describe, expect, test } from "bun:test"
import { AGENT_PROVIDERS } from "./core-types"
import { providerExpandsSlashCommands, providerUsesSdkSession } from "./provider-model-types"

describe("providerExpandsSlashCommands", () => {
  test("claude and openrouter expand `/name` themselves — the SDK reads the catalog", () => {
    expect(providerExpandsSlashCommands("claude")).toBe(true)
    expect(providerExpandsSlashCommands("openrouter")).toBe(true)
  })

  test("codex does not, so Kanna expands for it", () => {
    expect(providerExpandsSlashCommands("codex")).toBe(false)
  })

  test("every provider has an answer", () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(typeof providerExpandsSlashCommands(provider)).toBe("boolean")
    }
  })

  test("agrees with providerUsesSdkSession today", () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(providerExpandsSlashCommands(provider)).toBe(providerUsesSdkSession(provider))
    }
  })
})
