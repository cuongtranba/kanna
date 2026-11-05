import { test, expect } from "vite-plus/test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateMcpServer, networkHeaders } from "./mcp-validator"
import type { McpServerConfig } from "../shared/types"
import { isJsonObject, safeJsonParse, type JsonObject } from "../shared/json"

const STUB_OK_SCRIPT = `
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
const s = new McpServer({ name: "stub", version: "0.0.0" })
s.tool("ping", "p", async () => ({ content: [{ type: "text", text: "pong" }] }))
await s.connect(new StdioServerTransport())
`

const STUB_SLEEPER_SCRIPT = `setInterval(() => {}, 1000)`

const tmpStubOk = join(tmpdir(), `mcp-stub-ok-${process.pid}.mjs`)
const tmpStubSleeper = join(tmpdir(), `mcp-stub-sleeper-${process.pid}.mjs`)

await Bun.write(tmpStubOk, STUB_OK_SCRIPT)
await Bun.write(tmpStubSleeper, STUB_SLEEPER_SCRIPT)

function baseStdio(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "id",
    name: "test",
    enabled: true,
    createdAt: "",
    updatedAt: "",
    lastTest: { status: "untested" },
    transport: "stdio",
    command: process.execPath,
    args: [tmpStubOk],
    env: {},
    ...overrides,
  } as McpServerConfig
}

test("stdio happy path returns ok with toolCount", async () => {
  const result = await validateMcpServer(baseStdio(), { timeoutMs: 10_000 })
  if (result.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  expect(result.toolCount).toBeGreaterThanOrEqual(1)
}, 15_000)

test("stdio ENOENT yields command not found message", async () => {
  const result = await validateMcpServer(
    baseStdio({ transport: "stdio", command: "/does/not/exist/zzz", args: [] } as Partial<McpServerConfig>),
    { timeoutMs: 3_000 },
  )
  if (result.status !== "error") throw new Error("expected error")
  expect(result.message.toLowerCase()).toContain("command not found")
}, 5_000)

test("stdio timeout returns timeout error", async () => {
  const result = await validateMcpServer(
    baseStdio({ transport: "stdio", command: process.execPath, args: [tmpStubSleeper], env: {} } as Partial<McpServerConfig>),
    { timeoutMs: 500 },
  )
  if (result.status !== "error") throw new Error("expected error")
  expect(result.message.toLowerCase()).toContain("timed out")
}, 5_000)

test("networkHeaders adds bearer for oauth server", () => {
  expect(networkHeaders({ headers: { X: "1" } } as never, "AT")).toEqual({ X: "1", Authorization: "Bearer AT" })
})

test("networkHeaders leaves headers unchanged when no bearer", () => {
  expect(networkHeaders({ headers: { K: "v" } } as never, undefined)).toEqual({ K: "v" })
})

test("http 401 surfaces unauthorized", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 401 }) })
  try {
    const cfg: McpServerConfig = {
      id: "id",
      name: "test",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastTest: { status: "untested" },
      transport: "http",
      url: `http://127.0.0.1:${server.port}/mcp`,
      headers: {},
    }
    const result = await validateMcpServer(cfg, { timeoutMs: 3_000 })
    if (result.status !== "error") throw new Error("expected error")
    expect(result.message.toLowerCase()).toMatch(/unauthorized|401/)
  } finally {
    server.stop()
  }
}, 10_000)

test("http connect test ends the server session so no session is left open", async () => {
  const sessionId = "session-1"
  const deletes: (string | null)[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "DELETE") {
        deletes.push(request.headers.get("mcp-session-id"))
        return new Response(null, { status: 200 })
      }
      if (request.method === "GET") return new Response(null, { status: 405 })
      const body = safeJsonParse(await request.text())
      if (body === null || !isJsonObject(body)) return new Response(null, { status: 400 })
      if (body.id === undefined) return new Response(null, { status: 202 })
      const reply = (result: JsonObject) =>
        Response.json({ jsonrpc: "2.0", id: body.id, result }, { headers: { "mcp-session-id": sessionId } })
      if (body.method === "initialize") {
        return reply({
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "session-stub", version: "1.0.0" },
        })
      }
      if (body.method === "tools/list") return reply({ tools: [] })
      return reply({})
    },
  })
  try {
    const cfg: McpServerConfig = {
      id: "id",
      name: "test",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      lastTest: { status: "untested" },
      transport: "http",
      url: `http://127.0.0.1:${server.port}/mcp`,
      headers: {},
    }
    const result = await validateMcpServer(cfg, { timeoutMs: 5_000 })
    expect(result.status).toBe("ok")
    expect(deletes).toEqual([sessionId])
  } finally {
    await server.stop(true)
  }
}, 15_000)
