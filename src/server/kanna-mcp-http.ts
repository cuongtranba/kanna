import http from "node:http"
import { randomBytes, randomUUID } from "node:crypto"
import type { AddressInfo } from "node:net"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { buildKannaMcpTools, type KannaMcpArgs } from "./kanna-mcp"

export interface KannaMcpHttpHandle {
  /** Full URL including path the claude CLI must POST/GET against. */
  url: string
  /** Bearer token the CLI must present in Authorization header. */
  bearerToken: string
  /** Tear down HTTP listener + MCP transport. Idempotent. */
  close: () => Promise<void>
}

export interface StartKannaMcpHttpServerOptions {
  args: KannaMcpArgs
  /** Override host. Defaults to 127.0.0.1 (loopback-only). */
  host?: string
  /** Optional fixed port for tests. 0 = pick ephemeral. Defaults to 0. */
  port?: number
}

/**
 * Starts an in-process HTTP MCP server bound to loopback. The claude CLI
 * subprocess (PTY driver) reaches kanna's tool-callback / tunnel-gateway /
 * permission-policy state by connecting over HTTP. Bearer token in
 * Authorization header gates each request — random per spawn, never reused.
 *
 * Loopback-only bind by design: tokens live in process memory and the
 * --mcp-config JSON passed to the CLI; both are scoped to this machine.
 */
export async function startKannaMcpHttpServer(
  opts: StartKannaMcpHttpServerOptions,
): Promise<KannaMcpHttpHandle> {
  const bearerToken = randomBytes(32).toString("hex")
  const host = opts.host ?? "127.0.0.1"
  const port = opts.port ?? 0

  const mcp = new McpServer({
    name: KANNA_MCP_SERVER_NAME,
    version: "1.0.0",
  })

  const tools = buildKannaMcpTools(opts.args)
  for (const def of tools) {
    registerToolOnMcpServer(mcp, def)
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await mcp.connect(transport)

  const httpServer = http.createServer((req, res) => {
    if (!authorize(req, bearerToken)) {
      res.statusCode = 401
      res.setHeader("WWW-Authenticate", "Bearer")
      res.end("unauthorized")
      return
    }
    void transport.handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.end(String(err))
      }
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject)
      httpServer.listen(port, host, () => {
        httpServer.off("error", reject)
        resolve()
      })
    })
  } catch (err) {
    try { await transport.close() } catch { /* swallow */ }
    throw err
  }

  const address = httpServer.address() as AddressInfo
  const url = `http://${host}:${address.port}/mcp`

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    try {
      await transport.close()
    } catch {
      /* swallow */
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  }

  return { url, bearerToken, close }
}

function authorize(req: http.IncomingMessage, bearerToken: string): boolean {
  const header = req.headers.authorization
  if (!header || typeof header !== "string") return false
  const prefix = "Bearer "
  if (!header.startsWith(prefix)) return false
  const supplied = header.slice(prefix.length).trim()
  return constantTimeEqual(supplied, bearerToken)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function registerToolOnMcpServer(
  mcp: McpServer,
  def: SdkMcpToolDefinition,
): void {
  mcp.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
    },
    async (input: unknown, extra: unknown) => {
      return await def.handler(input as never, extra)
    },
  )
}

/**
 * Builds the --mcp-config JSON string the PTY driver passes to the claude
 * CLI. Encodes the HTTP MCP server URL + bearer token under the kanna
 * server name so the model sees tools as `mcp__kanna__<name>`.
 */
export function buildMcpConfigJson(handle: { url: string; bearerToken: string }): string {
  return JSON.stringify({
    mcpServers: {
      [KANNA_MCP_SERVER_NAME]: {
        type: "http",
        url: handle.url,
        headers: {
          Authorization: `Bearer ${handle.bearerToken}`,
        },
      },
    },
  })
}
