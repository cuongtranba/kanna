import { describe, expect, test } from "vite-plus/test"
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
  itemsPath: "",
  itemKeyPath: null,
  resyncIntervalMs: null,
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

  test("a reply target needs a tool, named arguments and a non-empty value map", () => {
    const reply = { tool: "send", args: { text: "{{reply.text}}" }, resultIdPath: "" }
    expect(validateMcpSource({ ...subscribe, reply })).toEqual([])
    expect(validateMcpSource({ ...subscribe, reply: { ...reply, tool: " " } })).toEqual(["Reply tool is required"])
    expect(validateMcpSource({ ...subscribe, reply: { ...reply, args: { "": "x" } } })).toEqual(["Reply argument names must not be empty"])
    expect(validateMcpSource({ ...subscribe, reply: { ...reply, args: { kind: { from: "message.type", map: {} } } } })).toEqual(['Reply argument "kind" needs at least one mapping'])
    expect(validateMcpSource({ ...subscribe, reply: { ...reply, resultIdPath: "x".repeat(INBOUND_LIMITS.pathMaxChars + 1) } })).toEqual([`Paths must be at most ${INBOUND_LIMITS.pathMaxChars} characters`])
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

  test("every preset fills a form that validates once a server and project are picked", () => {
    for (const preset of Object.values(MCP_SOURCE_PRESETS)) {
      const { label, ...template } = preset
      const input: McpSourceInput = { ...template, name: label, serverId: "s1", handler: { ...template.handler, projectId: "p1" } }
      expect(validateMcpSource(input)).toEqual([])
    }
  })

  test("over-long item paths on a subscribe source are refused", () => {
    expect(validateMcpSource({ ...subscribe, itemsPath: "x".repeat(INBOUND_LIMITS.pathMaxChars + 1) })[0]).toContain("Paths must be at most")
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
