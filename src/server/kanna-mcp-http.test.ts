import { describe, expect, test } from "bun:test"
import { startKannaMcpHttpServer, buildMcpConfigJson, buildChannelNotification } from "./kanna-mcp-http"
import type { McpServerConfig } from "../shared/types"

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

describe("buildChannelNotification", () => {
  test("builds a notifications/claude/channel payload with kanna source", () => {
    const n = buildChannelNotification("do the thing")
    expect(n.method).toBe("notifications/claude/channel")
    expect(n.params.content).toBe("do the thing")
    expect(n.params.meta).toEqual({ source: "kanna" })
  })

  test("merges extra meta but keeps source=kanna", () => {
    const n = buildChannelNotification("x", { eventType: "delegate" })
    expect(n.params.meta).toEqual({ source: "kanna", eventType: "delegate" })
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

describe("startKannaMcpHttpServer channel surface", () => {
  const channelArgs = {
    projectId: "p1",
    localPath: "/tmp",
    chatId: "c1",
    sessionId: "s1",
    tunnelGateway: null,
    forceInteractiveToolCallbacks: true,
  } as unknown as Parameters<typeof startKannaMcpHttpServer>[0]["args"]

  test("handle exposes pushChannelPrompt + channelClientReady", async () => {
    const handle = await startKannaMcpHttpServer({ args: channelArgs, port: 0 })
    try {
      expect(typeof handle.pushChannelPrompt).toBe("function")
      expect(handle.channelClientReady).toBeInstanceOf(Promise)
    } finally {
      await handle.close()
    }
  })

  test("pushChannelPrompt does not throw before a client connects (no-op safe)", async () => {
    const handle = await startKannaMcpHttpServer({ args: channelArgs, port: 0 })
    try {
      await handle.pushChannelPrompt("hello")
    } finally {
      await handle.close()
    }
  })
})

const HANDLE = { url: "http://127.0.0.1:1234/mcp", bearerToken: "tok" }

function stdio(name: string, command = "/bin/ls", enabled = true): McpServerConfig {
  return {
    id: name,
    name,
    enabled,
    createdAt: "", updatedAt: "",
    lastTest: { status: "untested" },
    transport: "stdio",
    command,
    args: ["-la"],
    env: { FOO: "bar" },
  }
}

describe("buildMcpConfigJson — user servers", () => {
  test("no user servers keeps just kanna", () => {
    const json = JSON.parse(buildMcpConfigJson(HANDLE))
    expect(Object.keys(json.mcpServers)).toEqual(["kanna"])
  })

  test("stdio user entry included with correct shape", () => {
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("fs")]))
    expect(json.mcpServers.fs).toEqual({
      type: "stdio",
      command: "/bin/ls",
      args: ["-la"],
      env: { FOO: "bar" },
    })
  })

  test("stdio with cwd includes cwd", () => {
    const cfg: McpServerConfig = { ...stdio("fs"), cwd: "/tmp/work" } as McpServerConfig
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg]))
    expect(json.mcpServers.fs.cwd).toBe("/tmp/work")
  })

  test("disabled entries dropped", () => {
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("fs", "/bin/ls", false)]))
    expect(json.mcpServers.fs).toBeUndefined()
  })

  test("collision with KANNA_MCP_SERVER_NAME filtered", () => {
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("kanna")]))
    expect(Object.keys(json.mcpServers)).toEqual(["kanna"])
    expect(json.mcpServers.kanna.url).toBe("http://127.0.0.1:1234/mcp")
  })

  test("http user entry passes headers", () => {
    const cfg: McpServerConfig = {
      id: "x", name: "remote", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "http", url: "https://api.example.com/mcp", headers: { "x-key": "secret" },
    }
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg]))
    expect(json.mcpServers.remote).toEqual({
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { "x-key": "secret" },
    })
  })

  test("sse user entry uses type: sse", () => {
    const cfg: McpServerConfig = {
      id: "s", name: "events", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "sse", url: "https://example.com/sse", headers: {},
    }
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg]))
    expect(json.mcpServers.events.type).toBe("sse")
  })

  test("ws user entry uses type: ws", () => {
    const cfg: McpServerConfig = {
      id: "w", name: "wsx", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "ws", url: "wss://example.com/ws", headers: {},
    }
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg]))
    expect(json.mcpServers.wsx.type).toBe("ws")
  })

  test("multiple servers preserved in order", () => {
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [stdio("a"), stdio("b"), stdio("c")]))
    expect(Object.keys(json.mcpServers)).toEqual(["kanna", "a", "b", "c"])
  })

  test("injects oauth bearer header for authenticated server", () => {
    const cfg: McpServerConfig = {
      id: "s1", name: "design", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "http", url: "https://api.example/mcp", headers: {},
      oauth: { enabled: true, status: "authenticated", tokens: { access_token: "AT", token_type: "Bearer" } as never },
    }
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg], new Map([["s1", "AT"]])))
    expect(json.mcpServers.design.headers.Authorization).toBe("Bearer AT")
  })

  test("omits Authorization when no bearer resolved", () => {
    const cfg: McpServerConfig = {
      id: "s2", name: "plain", enabled: true,
      createdAt: "", updatedAt: "", lastTest: { status: "untested" },
      transport: "http", url: "https://api.example/mcp", headers: {},
    }
    const json = JSON.parse(buildMcpConfigJson(HANDLE, [cfg], new Map()))
    expect(json.mcpServers.plain.headers?.Authorization).toBeUndefined()
  })
})
