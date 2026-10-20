import { describe, expect, test } from "bun:test"
import type { McpPollSource } from "../../shared/mcp-sources/types"
import {
  applyZaloPreset,
  draftFromMcpSource,
  emptyMcpSourceDraft,
  mcpSourceInputFromDraft,
  mcpSourcePatchFromInput,
} from "./mcpSourceDraft"

const POLL: McpPollSource = {
  id: "s1",
  name: "Zalo",
  mode: "poll",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  handler: { mode: "inline", chatId: "c1", provider: "claude", model: "claude-sonnet-4-6", template: "t", replyHint: "h", pushEnabled: false },
  tool: "zalo_get_messages",
  args: { limit: 50 },
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: null,
  intervalMs: 15000,
  createdAt: 1,
  updatedAt: 1,
}

describe("mcp source draft", () => {
  test("a stored poll source round-trips through the form unchanged", () => {
    const result = mcpSourceInputFromDraft(draftFromMcpSource(POLL))
    expect(result).toEqual({
      ok: true,
      input: {
        mode: "poll",
        name: "Zalo",
        serverId: "srv",
        threadKeyPath: "threadId",
        senderPath: "senderName",
        handler: POLL.handler,
        tool: "zalo_get_messages",
        args: { limit: 50 },
        cursorArg: "since",
        cursorPath: "cursor",
        itemsPath: "messages",
        itemKeyPath: null,
        intervalMs: 15000,
      },
    })
  })

  test("the Zalo preset fills a poll form that needs only a server and project", () => {
    const filled = applyZaloPreset({ ...emptyMcpSourceDraft(), serverId: "srv", projectId: "p1" })
    expect(filled).toMatchObject({ name: "Zalo", mode: "poll", tool: "zalo_get_messages", intervalSeconds: "15", handlerMode: "spawn", projectId: "p1" })
    const result = mcpSourceInputFromDraft(filled)
    expect(result.ok).toBe(true)
  })

  test("invalid arguments JSON and a missing interval are reported before anything is sent", () => {
    const result = mcpSourceInputFromDraft({ ...applyZaloPreset({ ...emptyMcpSourceDraft(), serverId: "srv", projectId: "p1" }), argsText: "[1]", intervalSeconds: "soon" })
    expect(result).toEqual({ ok: false, errors: ["Arguments must be a JSON object", "Interval must be a number of seconds"] })
  })

  test("a subscribe form splits URIs on lines and drops blanks", () => {
    const result = mcpSourceInputFromDraft({ ...emptyMcpSourceDraft(), name: "Feed", serverId: "srv", resourceUris: "feed://a\n\n  feed://b  \n", handlerMode: "notify", chatId: "c1" })
    expect(result).toMatchObject({ ok: true, input: { mode: "subscribe", resourceUris: ["feed://a", "feed://b"], handler: { mode: "notify", chatId: "c1" } } })
  })

  test("an edit patch carries every field so a mode switch is complete and never the enabled flag", () => {
    const result = mcpSourceInputFromDraft(draftFromMcpSource(POLL))
    if (!result.ok) throw new Error("draft should be valid")
    const patch = mcpSourcePatchFromInput(result.input)
    expect(patch).toMatchObject({ mode: "poll", tool: "zalo_get_messages", itemKeyPath: null })
    expect("enabled" in patch).toBe(false)
  })
})
