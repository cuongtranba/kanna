import { describe, expect, test } from "vite-plus/test"
import type { McpPollSource, McpSubscribeSource } from "../../shared/mcp-sources/types"
import {
  applyPreset,
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

const SUBSCRIBE: McpSubscribeSource = {
  id: "s2",
  name: "Inbox",
  mode: "subscribe",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  handler: { mode: "notify", chatId: "c1", template: "t", replyHint: "", pushEnabled: true },
  resourceUris: ["feed://inbox"],
  itemsPath: "messages",
  itemKeyPath: "id",
  resyncIntervalMs: 300_000,
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

  test("the Zalo preset fills a subscribe form keyed by message id that needs only a server and project", () => {
    const filled = applyPreset({ ...emptyMcpSourceDraft(), serverId: "srv", projectId: "p1" }, "zalo")
    expect(filled).toMatchObject({
      name: "Zalo",
      mode: "subscribe",
      resourceUris: "zalo://inbox",
      subscribeItemsPath: "messages",
      subscribeItemKeyPath: "id",
      resyncSeconds: "300",
      handlerMode: "spawn",
      projectId: "p1",
    })
    expect(mcpSourceInputFromDraft(filled)).toMatchObject({
      ok: true,
      input: { mode: "subscribe", itemsPath: "messages", itemKeyPath: "id", resyncIntervalMs: 300_000 },
    })
  })

  test("a stored subscribe source round-trips its item fields and a blank resync means none", () => {
    const draft = draftFromMcpSource(SUBSCRIBE)
    expect(mcpSourceInputFromDraft(draft)).toMatchObject({
      ok: true,
      input: { mode: "subscribe", itemsPath: "messages", itemKeyPath: "id", resyncIntervalMs: 300_000 },
    })
    expect(mcpSourceInputFromDraft({ ...draft, subscribeItemKeyPath: "", resyncSeconds: "" })).toMatchObject({
      ok: true,
      input: { itemKeyPath: null, resyncIntervalMs: null },
    })
  })

  test("a resync interval that is not a number is reported before anything is sent", () => {
    const result = mcpSourceInputFromDraft({ ...draftFromMcpSource(SUBSCRIBE), resyncSeconds: "often" })
    expect(result).toEqual({ ok: false, errors: ["Resync interval must be a number of seconds"] })
  })

  test("invalid arguments JSON and a missing interval are reported before anything is sent", () => {
    const result = mcpSourceInputFromDraft({ ...draftFromMcpSource(POLL), argsText: "[1]", intervalSeconds: "soon", serverId: "srv", projectId: "p1" })
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
