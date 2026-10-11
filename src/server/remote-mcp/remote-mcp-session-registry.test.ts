import { describe, expect, test } from "bun:test"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createRemoteMcpSessionRegistry } from "./remote-mcp-session-registry"

const AUTH_INFO = { token: "", clientId: "test", scopes: ["kanna"] }

function initializeRequest(sessionId?: string): Request {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  })
  if (sessionId) headers.set("mcp-session-id", sessionId)
  return new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }),
  })
}

function createRegistry(clock: { now: number }, maxSessions = 64) {
  return createRemoteMcpSessionRegistry({
    buildServer: () => new McpServer({ name: "kanna", version: "0" }),
    now: () => clock.now,
    idleMs: 1000,
    maxSessions,
  })
}

async function open(registry: ReturnType<typeof createRegistry>): Promise<string> {
  const response = await registry.handle(initializeRequest(), AUTH_INFO)
  const sessionId = response.headers.get("mcp-session-id")
  if (!sessionId) throw new Error(`no session id (status ${response.status})`)
  await response.text()
  return sessionId
}

describe("remote MCP session registry", () => {
  test("a session idle past the limit is closed and its id then answers 404", async () => {
    const clock = { now: 0 }
    const registry = createRegistry(clock)
    try {
      const sessionId = await open(registry)
      expect(registry.size()).toBe(1)

      clock.now = 5000
      await registry.sweepIdle()

      expect(registry.size()).toBe(0)
      const reused = await registry.handle(initializeRequest(sessionId), AUTH_INFO)
      expect(reused.status).toBe(404)
    } finally {
      await registry.dispose()
    }
  })

  test("a session that keeps being used survives the sweep", async () => {
    const clock = { now: 0 }
    const registry = createRegistry(clock)
    try {
      const sessionId = await open(registry)
      clock.now = 900
      const touched = await registry.handle(initializeRequest(sessionId), AUTH_INFO)
      await touched.text()
      clock.now = 1500

      await registry.sweepIdle()

      expect(registry.size()).toBe(1)
    } finally {
      await registry.dispose()
    }
  })

  test("opening a session beyond the cap evicts the least recently used one", async () => {
    const clock = { now: 0 }
    const registry = createRegistry(clock, 2)
    try {
      const oldest = await open(registry)
      clock.now = 10
      await open(registry)
      clock.now = 20
      await open(registry)

      expect(registry.size()).toBe(2)
      const evicted = await registry.handle(initializeRequest(oldest), AUTH_INFO)
      expect(evicted.status).toBe(404)
    } finally {
      await registry.dispose()
    }
  })

  test("a request that never initializes leaves no session behind", async () => {
    const clock = { now: 0 }
    const registry = createRegistry(clock)
    try {
      const response = await registry.handle(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
        AUTH_INFO,
      )

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(registry.size()).toBe(0)
    } finally {
      await registry.dispose()
    }
  })
})
