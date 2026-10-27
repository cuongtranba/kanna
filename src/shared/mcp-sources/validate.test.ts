import { describe, expect, test } from "bun:test"
import { MCP_SOURCE_PRESETS } from "./presets"
import { INBOUND_LIMITS } from "../inbound/handler"
import type { McpSourceInput } from "./types"
import { parseMcpSourceArgs, validateMcpSource } from "./validate"

const handler = { mode: "spawn" as const, projectId: "p1", template: "New message", replyHint: "", pushEnabled: true }

const subscribe: McpSourceInput = {
  mode: "subscribe",
  name: "Feed",
  serverId: "s1",
  threadKeyPath: "",
  senderPath: "",
  handler,
  resourceUris: ["feed://inbox"],
}

const poll: McpSourceInput = {
  mode: "poll",
  name: "Zalo",
  serverId: "s1",
  threadKeyPath: "threadId",
  senderPath: "senderName",
  handler,
  tool: "zalo_get_messages",
  args: { limit: 50 },
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: "messageId",
  intervalMs: 15000,
}

describe("validateMcpSource", () => {
  test("accepts a complete subscribe and a complete poll source", () => {
    expect(validateMcpSource(subscribe)).toEqual([])
    expect(validateMcpSource(poll)).toEqual([])
  })

  test("a subscribe source without a resource URI is refused", () => {
    expect(validateMcpSource({ ...subscribe, resourceUris: ["  "] })).toEqual(["At least one resource URI is required"])
  })

  test("a poll source names every missing field", () => {
    const errors = validateMcpSource({ ...poll, tool: "", cursorArg: "", cursorPath: " ", itemsPath: "" })
    expect(errors).toEqual(["Tool is required", "Cursor argument is required", "Cursor path is required", "Items path is required"])
  })

  test("name, server and handler target are checked", () => {
    const errors = validateMcpSource({
      ...subscribe,
      name: " ".repeat(2),
      serverId: "",
      handler: { ...handler, projectId: undefined },
    })
    expect(errors).toContain("Name is required")
    expect(errors).toContain("An MCP server is required")
    expect(errors).toContain("A project is required for spawn hooks")
    expect(validateMcpSource({ ...subscribe, name: "x".repeat(INBOUND_LIMITS.nameMaxChars + 1) })[0]).toContain("at most")
  })

  test("the Zalo preset fills a form that validates once a server and project are picked", () => {
    const preset = MCP_SOURCE_PRESETS.zalo
    const input: McpSourceInput = {
      mode: "poll",
      name: preset.label,
      serverId: "s1",
      threadKeyPath: preset.threadKeyPath,
      senderPath: preset.senderPath,
      handler: { ...preset.handler, projectId: "p1" },
      tool: preset.tool,
      args: preset.args,
      cursorArg: preset.cursorArg,
      cursorPath: preset.cursorPath,
      itemsPath: preset.itemsPath,
      itemKeyPath: preset.itemKeyPath,
      intervalMs: preset.intervalMs,
    }
    expect(validateMcpSource(input)).toEqual([])
  })
})

describe("parseMcpSourceArgs", () => {
  test("empty text is an empty object, an object parses, anything else is refused", () => {
    expect(parseMcpSourceArgs("  ")).toEqual({ args: {} })
    expect(parseMcpSourceArgs('{"limit":5}')).toEqual({ args: { limit: 5 } })
    expect(parseMcpSourceArgs("[1]")).toEqual({ error: "Arguments must be a JSON object" })
    expect(parseMcpSourceArgs("{oops")).toEqual({ error: "Arguments must be a JSON object" })
  })
})
