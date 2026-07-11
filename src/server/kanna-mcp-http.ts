import { randomBytes, randomUUID } from "node:crypto"
import { closeHttpServer, createHttpServer, listen, type HttpIncomingMessage } from "./http-server.adapter"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js"
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { buildKannaMcpTools, type KannaMcpArgs } from "./kanna-mcp"
import type { McpServerConfig } from "../shared/types"
import type { AnyValue } from "../shared/errors"

export interface ChannelNotification {
  method: "notifications/claude/channel"
  params: { content: string; meta: Record<string, AnyValue>; _meta?: Record<string, AnyValue> }
}

/**
 * Builds the channel push payload. `source` is pinned to the kanna server
 * name so claude tags the injected prompt `<channel source="kanna">`.
 */
export function buildChannelNotification(
  content: string,
  meta: Record<string, unknown> = {},
): ChannelNotification {
  return {
    method: "notifications/claude/channel",
    params: { content, meta: { source: KANNA_MCP_SERVER_NAME, ...meta } },
  }
}

export interface KannaMcpHttpHandle {
  /** Full URL including path the claude CLI must POST/GET against. */
  url: string
  /** Bearer token the CLI must present in Authorization header. */
  bearerToken: string
  /** Tear down HTTP listener + MCP transport. Idempotent. */
  close: () => Promise<void>
  /** Resolves once the claude MCP client completes the initialize handshake. */
  channelClientReady: Promise<void>
  /** Push a prompt into the live claude session via the channel capability. */
  pushChannelPrompt: (content: string, meta?: Record<string, unknown>) => Promise<void>
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

  const mcp = new McpServer(
    { name: KANNA_MCP_SERVER_NAME, version: "1.0.0" },
    {
      capabilities: {
        experimental: {
          "claude/channel": {},
          "claude/channel/permission": {},
        },
      },
    },
  )

  const tools = buildKannaMcpTools(opts.args)
  for (const def of tools) {
    registerToolOnMcpServer(mcp, def)
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await mcp.connect(transport)

  let resolveReady: () => void = () => {}
  const channelClientReady = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  mcp.server.oninitialized = () => {
    resolveReady()
  }

  const pushChannelPrompt = async (
    content: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> => {
    const notification = buildChannelNotification(content, meta)
    try {
      await mcp.server.notification(<ServerNotification><unknown>notification)
    } catch (err) {
      // Before a client connects there is no peer; swallow that case.
      if (mcp.isConnected()) throw err
    }
  }

  const httpServer = createHttpServer((req, res) => {
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

  let address
  try {
    address = await listen(httpServer, port, host)
  } catch (err) {
    try { await transport.close() } catch { /* swallow */ }
    throw err
  }

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
    await closeHttpServer(httpServer)
  }

  return { url, bearerToken, close, channelClientReady, pushChannelPrompt }
}

function authorize(req: HttpIncomingMessage, bearerToken: string): boolean {
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
    async (input: AnyValue, extra: AnyValue) => {
      return await def.handler(<Record<string, AnyValue>>input, extra)
    },
  )
}

/**
 * Builds the --mcp-config JSON string the PTY driver passes to the claude
 * CLI. Encodes the HTTP MCP server URL + bearer token under the kanna
 * server name so the model sees tools as `mcp__kanna__<name>`.
 *
 * Optional `userServers` merges enabled user-configured MCP entries into
 * the JSON. Disabled entries and any whose name collides with
 * KANNA_MCP_SERVER_NAME are silently dropped.
 */
export function buildMcpConfigJson(
  handle: { url: string; bearerToken: string },
  userServers: readonly McpServerConfig[] = [],
  oauthBearers: ReadonlyMap<string, string> = new Map(),
): string {
  const mcpServers: Record<string, unknown> = {
    [KANNA_MCP_SERVER_NAME]: {
      type: "http",
      url: handle.url,
      headers: {
        Authorization: `Bearer ${handle.bearerToken}`,
      },
    },
  }
  for (const s of userServers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    mcpServers[s.name] = toClaudeCliMcpEntry(s, oauthBearers.get(s.id))
  }
  return JSON.stringify({ mcpServers })
}

function toClaudeCliMcpEntry(s: McpServerConfig, oauthBearer?: string): Record<string, unknown> {
  if (s.transport === "stdio") {
    return {
      type: "stdio",
      command: s.command,
      args: s.args,
      env: s.env,
      ...(s.cwd ? { cwd: s.cwd } : {}),
    }
  }
  const headers = oauthBearer ? { ...s.headers, Authorization: `Bearer ${oauthBearer}` } : s.headers
  return {
    type: s.transport,
    url: s.url,
    headers,
  }
}
