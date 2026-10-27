import { describe, expect, test } from "vite-plus/test"
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

  test("an unknown command type is rejected", () => {
    expect(parseClientCommand({ type: "chat.explode" })).toEqual({ ok: false, error: 'Unknown command "chat.explode"' })
  })
})
