import { afterEach, describe, expect, test } from "bun:test"
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { SdkError, SdkErrorCode, type McpSubscription } from "@modelcontextprotocol/client"
import { z } from "zod"
import type { JsonObject } from "../../shared/json"
import type { McpServerConfig } from "../../shared/mcp-types"
import {
  createMcpSourceConnector,
  isLegacyProtocolError,
  openListening,
  resourceContentsValue,
  toolResultValue,
  type McpListenClient,
} from "./mcp-source-client.adapter"
import type { McpSourceCloseReason, McpSourceConnection } from "./mcp-source-runner"

const stoppers: (() => void)[] = []

afterEach(() => {
  for (const stop of stoppers.splice(0)) stop()
})

function subscription(honored: string[]): McpSubscription {
  return { honoredFilter: { resourceSubscriptions: honored }, closed: new Promise<McpSourceCloseReason>(() => {}), close: async () => {} }
}

describe("openListening", () => {
  test("a 2026-era server's honored subset is reported as is", async () => {
    const client: McpListenClient = {
      listen: async () => subscription(["feed://a"]),
      subscribeResource: async () => {
        throw new Error("must not subscribe")
      },
    }
    const listening = await openListening(client, ["feed://a", "feed://b"], new Promise<McpSourceCloseReason>(() => {}))
    expect(listening.honoredUris).toEqual(["feed://a"])
  })

  test("a 2025-era server falls back to per-resource subscribe and closes with the transport", async () => {
    const subscribed: string[] = []
    const client: McpListenClient = {
      listen: async () => {
        throw new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, "use resources/subscribe")
      },
      subscribeResource: async ({ uri }) => {
        subscribed.push(uri)
        return {}
      },
    }
    const transportClosed = Promise.resolve<McpSourceCloseReason>("remote")
    const listening = await openListening(client, ["feed://a", "feed://b"], transportClosed)

    expect(subscribed).toEqual(["feed://a", "feed://b"])
    expect(listening.honoredUris).toEqual(["feed://a", "feed://b"])
    expect(await listening.closed).toBe("remote")
  })

  test("any other listen failure is not mistaken for a legacy server", async () => {
    const client: McpListenClient = {
      listen: async () => {
        throw new Error("connection refused")
      },
      subscribeResource: async () => ({}),
    }
    await expect(openListening(client, ["feed://a"], new Promise<McpSourceCloseReason>(() => {}))).rejects.toThrow("connection refused")
    expect(isLegacyProtocolError(new Error("x"))).toBe(false)
  })
})

describe("result mapping", () => {
  test("structured content wins, JSON text is parsed, plain text stays text and an error result throws", () => {
    expect(toolResultValue({ content: [{ type: "text", text: "ignored" }], structuredContent: { cursor: 3 } })).toEqual({ cursor: 3 })
    expect(toolResultValue({ content: [{ type: "text", text: '{"messages":[]}' }] })).toEqual({ messages: [] })
    expect(toolResultValue({ content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] })).toBe("hello\nworld")
    expect(() => toolResultValue({ content: [{ type: "text", text: "boom" }], isError: true })).toThrow("boom")
  })

  test("resource contents map to JSON, text and a binary placeholder", () => {
    expect(resourceContentsValue([{ uri: "a", mimeType: "application/json", text: '{"n":1}' }])).toEqual({ n: 1 })
    expect(resourceContentsValue([{ uri: "a", text: "plain" }])).toBe("plain")
    expect(resourceContentsValue([{ uri: "a", text: "x" }, { uri: "b", text: "y" }])).toEqual(["x", "y"])
    expect(resourceContentsValue([{ uri: "a", mimeType: "image/png", blob: "AAAA" }])).toBe("[binary resource image/png, 4 base64 characters]")
  })
})

describe("against a real MCP server", () => {
  function configFor(url: string): McpServerConfig {
    return {
      id: "srv",
      name: "fixture",
      enabled: true,
      transport: "http",
      url,
      headers: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastTest: { status: "untested" },
    }
  }

  async function startServer(): Promise<McpServerConfig> {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "fixture", version: "1.0.0" })
      server.registerTool(
        "get_messages",
        { description: "messages", inputSchema: z.object({ since: z.number().optional(), limit: z.number().optional() }) },
        async ({ since }) => ({ content: [{ type: "text", text: JSON.stringify({ messages: [{ messageId: "m1", since: since ?? null }], cursor: 11 }) }] }),
      )
      server.registerResource("inbox", "feed://inbox", { mimeType: "application/json" }, async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "application/json", text: '{"unread":2}' }],
      }))
      return server
    })
    const http = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => handler.fetch(request) })
    stoppers.push(() => {
      void http.stop(true)
      void handler.close()
    })
    return configFor(`http://127.0.0.1:${http.port}/mcp`)
  }

  test("a poll tool call and a resource read come back as JSON", async () => {
    const config = await startServer()
    const connection: McpSourceConnection = await createMcpSourceConnector().open(config, undefined)
    try {
      const args: JsonObject = { since: 4 }
      expect(await connection.callTool("get_messages", args)).toEqual({ messages: [{ messageId: "m1", since: 4 }], cursor: 11 })
      expect(await connection.readResource("feed://inbox")).toEqual({ unread: 2 })
    } finally {
      await connection.close()
    }
  }, 30_000)

  test("a server the connector cannot reach rejects instead of hanging", async () => {
    await expect(createMcpSourceConnector().open(configFor("http://127.0.0.1:1/mcp"), undefined)).rejects.toBeInstanceOf(Error)
  }, 30_000)
})
