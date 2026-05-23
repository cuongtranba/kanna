import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validateMcpServer } from "./mcp-validator"
import type { McpServerConfig } from "../shared/types"

// Write stub to a temp file so bun resolves node_modules from the repo root
// instead of from an inline -e script whose cwd is unpredictable.
// Uses the high-level McpServer API (server.tool()) which auto-handles
// tools/list without requiring ListToolsRequestSchema (avoids z.looseObject issue in Bun).
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
