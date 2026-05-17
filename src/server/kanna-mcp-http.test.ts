import { describe, expect, test } from "bun:test"
import { startKannaMcpHttpServer, buildMcpConfigJson } from "./kanna-mcp-http"

const baseArgs = {
  projectId: "proj-test",
  localPath: "/tmp",
  chatId: "chat-test",
  sessionId: "sess-test",
  tunnelGateway: null,
}

describe("startKannaMcpHttpServer", () => {
  test("binds loopback on ephemeral port and exposes a /mcp URL", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      expect(handle.bearerToken).toHaveLength(64)
    } finally {
      await handle.close()
    }
  })

  test("rejects requests without Authorization header (401)", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    try {
      const res = await fetch(handle.url, { method: "POST", body: "{}" })
      expect(res.status).toBe(401)
    } finally {
      await handle.close()
    }
  })

  test("rejects requests with mismatched Bearer token (401)", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    try {
      const res = await fetch(handle.url, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
        body: "{}",
      })
      expect(res.status).toBe(401)
    } finally {
      await handle.close()
    }
  })

  test("rejects requests with non-Bearer scheme (401)", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    try {
      const res = await fetch(handle.url, {
        method: "POST",
        headers: { Authorization: `Basic ${handle.bearerToken}` },
        body: "{}",
      })
      expect(res.status).toBe(401)
    } finally {
      await handle.close()
    }
  })

  test("forwards requests past auth when Bearer matches", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    try {
      const res = await fetch(handle.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${handle.bearerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "kanna-pty-test", version: "0.0.0" },
          },
        }),
      })
      // Past auth: status is 200 (initialize succeeded) or some other
      // non-401 status from the MCP layer. Either way the bearer check
      // didn't block us.
      expect(res.status).not.toBe(401)
    } finally {
      await handle.close()
    }
  })

  test("close() shuts down the listener so subsequent requests fail", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    const url = handle.url
    await handle.close()
    await expect(
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${handle.bearerToken}` },
        body: "{}",
      }),
    ).rejects.toBeDefined()
  })

  test("close() is idempotent", async () => {
    const handle = await startKannaMcpHttpServer({ args: baseArgs })
    await handle.close()
    await handle.close()
  })
})

describe("buildMcpConfigJson", () => {
  test("encodes http MCP server config with Bearer header", () => {
    const json = buildMcpConfigJson({
      url: "http://127.0.0.1:55555/mcp",
      bearerToken: "abcdef0123456789",
    })
    const parsed = JSON.parse(json)
    expect(parsed.mcpServers.kanna.type).toBe("http")
    expect(parsed.mcpServers.kanna.url).toBe("http://127.0.0.1:55555/mcp")
    expect(parsed.mcpServers.kanna.headers.Authorization).toBe("Bearer abcdef0123456789")
  })
})
