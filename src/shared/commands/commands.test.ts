import { describe, expect, test } from "vite-plus/test"
import type { JsonObject } from "../json"
import { COMMAND_REGISTRY, parseClientCommand } from "./index"

describe("command registry", () => {
  test("every command excluded from remote use says why", () => {
    const reasons = COMMAND_REGISTRY.flatMap((definition) =>
      definition.remote.kind === "excluded" ? [definition.remote.reason.trim()] : [],
    )

    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.filter((reason) => reason.length === 0)).toEqual([])
  })

  test("a parsed command drops fields its params do not declare", () => {
    const parsed = parseClientCommand({ type: "chat.rename", chatId: "chat-1", title: "New", apiKey: "sk-leak" })

    expect(parsed).toEqual({ ok: true, command: { type: "chat.rename", chatId: "chat-1", title: "New" } })
  })

  test("a malformed param is rejected with an error naming the command and the failing path", () => {
    const parsed = parseClientCommand({
      type: "chat.send",
      chatId: "chat-1",
      content: "hi",
      modelOptions: { claude: { reasoningEffort: "loud" } },
    })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("expected a rejection")
    expect(parsed.error).toContain("chat.send")
    expect(parsed.error).toContain("modelOptions.claude.reasoningEffort")
  })

  test("a provider-defaults patch that changes only the context window is accepted, not rejected for a missing reasoningEffort", () => {
    const patch = { providerDefaults: { claude: { modelOptions: { contextWindow: "1m" } } } }

    expect(parseClientCommand({ type: "settings.writeAppSettingsPatch", patch })).toEqual({
      ok: true,
      command: { type: "settings.writeAppSettingsPatch", patch },
    })
  })

  test("cron.update accepts a model patch and rejects unknown patch keys, even inside modelOptions", () => {
    const update = (patch: JsonObject) =>
      parseClientCommand({ type: "cron.update", chatId: "chat-1", jobId: "cron-1", patch })

    expect(update({ model: "claude-sonnet-5-5" }).ok).toBe(true)
    expect(update({ modelOptions: { claude: { reasoningEffort: "low" } } }).ok).toBe(true)
    expect(update({ bogus: 1 }).ok).toBe(false)
    expect(update({ modelOptions: { claude: { effort: "low" } } }).ok).toBe(false)
  })

  test("an unknown command type is rejected", () => {
    expect(parseClientCommand({ type: "chat.explode" })).toEqual({ ok: false, error: 'Unknown command "chat.explode"' })
  })
})
