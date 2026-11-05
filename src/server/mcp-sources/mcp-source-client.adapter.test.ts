import { afterEach, describe, expect, test } from "vite-plus/test"
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { SdkError, SdkErrorCode, type McpSubscription } from "@modelcontextprotocol/client"
import { z } from "zod"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../../shared/json"
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

describe("openListening", () => {
  test("a 2026-era server's honored subset is reported as is", async () => {
    const client: McpListenClient = {
      listen: async () => subscription(["feed://a"]),
      subscribeResource: async () => {
        throw new Error("must not subscribe")
      },
      getServerCapabilities: () => undefined,
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
      getServerCapabilities: () => ({ resources: { subscribe: true } }),
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
      getServerCapabilities: () => ({ resources: { subscribe: true } }),
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

describe("against a 2025-era streamable HTTP server", () => {
  const SESSION_ID = "session-1"

  interface LegacyServer {
    config: McpServerConfig
    methods: string[]
    deletes: (string | null)[]
    stop: () => void
  }

  function jsonRpcResult(id: JsonValue | undefined, result: JsonObject): Response {
    return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "mcp-session-id": SESSION_ID } })
  }

  function startLegacyServer(options: { subscribe: boolean; streamGone: boolean }): LegacyServer {
    const server: LegacyServer = { config: configFor(""), methods: [], deletes: [], stop: () => {} }
    const http = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        if (request.method === "DELETE") {
          server.deletes.push(request.headers.get("mcp-session-id"))
          return new Response(null, { status: 200 })
        }
        if (request.method === "GET") {
          if (options.streamGone) return new Response("session not found", { status: 404 })
          return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } })
        }
        const body = safeJsonParse(await request.text())
        if (body === null || !isJsonObject(body)) return new Response(null, { status: 400 })
        const method = typeof body.method === "string" ? body.method : ""
        server.methods.push(method)
        if (body.id === undefined) return new Response(null, { status: 202 })
        switch (method) {
          case "initialize":
            return jsonRpcResult(body.id, {
              protocolVersion: "2025-11-25",
              capabilities: { resources: { subscribe: options.subscribe } },
              serverInfo: { name: "legacy", version: "1.0.0" },
            })
          case "resources/read":
            return Response.json(
              { jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "Resource not found" } },
              { headers: { "mcp-session-id": SESSION_ID } },
            )
          default:
            return jsonRpcResult(body.id, {})
        }
      },
    })
    server.stop = () => { void http.stop(true) }
    stoppers.push(server.stop)
    server.config = configFor(`http://127.0.0.1:${http.port}/mcp`)
    return server
  }

  test("a server that does not advertise resource subscriptions is never sent resources/subscribe", async () => {
    const server = startLegacyServer({ subscribe: false, streamGone: false })
    const connection = await createMcpSourceConnector().open(server.config, undefined)
    try {
      const listening = await connection.listen(["feed://inbox"], () => {})
      expect(listening.honoredUris).toEqual([])
      expect(server.methods).not.toContain("resources/subscribe")
    } finally {
      await connection.close()
    }
  }, 30_000)

  test("a server that advertises resource subscriptions is subscribed to every URI", async () => {
    const server = startLegacyServer({ subscribe: true, streamGone: false })
    const connection = await createMcpSourceConnector().open(server.config, undefined)
    try {
      const listening = await connection.listen(["feed://inbox"], () => {})
      expect(listening.honoredUris).toEqual(["feed://inbox"])
      expect(server.methods).toContain("resources/subscribe")
    } finally {
      await connection.close()
    }
  }, 30_000)

  test("a session whose notification stream the server no longer knows ends as a remote close", async () => {
    const server = startLegacyServer({ subscribe: true, streamGone: true })
    const connection = await createMcpSourceConnector().open(server.config, undefined)
    try {
      const listening = await connection.listen(["feed://inbox"], () => {})
      expect(await listening.closed).toBe("remote")
    } finally {
      await connection.close()
    }
  }, 30_000)

  test("closing the connection ends the server session with the session id", async () => {
    const server = startLegacyServer({ subscribe: true, streamGone: false })
    const connection = await createMcpSourceConnector().open(server.config, undefined)
    await connection.close()

    expect(server.deletes).toEqual([SESSION_ID])
  }, 30_000)

  test("an error the server answers a read with keeps the session, a dead server ends it", async () => {
    const server = startLegacyServer({ subscribe: true, streamGone: false })
    const connection = await createMcpSourceConnector().open(server.config, undefined)
    try {
      const listening = await connection.listen(["feed://inbox"], () => {})
      await expect(connection.readResource("feed://missing")).rejects.toBeInstanceOf(Error)
      expect(await Promise.race([listening.closed, Promise.resolve("open")])).toBe("open")

      server.stop()
      await expect(connection.readResource("feed://missing")).rejects.toBeInstanceOf(Error)
      expect(await listening.closed).toBe("remote")
    } finally {
      await connection.close()
    }
  }, 30_000)
})
