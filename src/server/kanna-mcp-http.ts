import { registerSdkToolOnMcpServer } from "./mcp-zod-compat.adapter"
import { randomBytes, randomUUID } from "node:crypto"
import { closeHttpServer, createHttpServer, listen, type HttpIncomingMessage } from "./http-server.adapter"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { buildKannaMcpTools, type KannaMcpArgs } from "./kanna-mcp"
import type { McpServerConfig } from "../shared/types"
import type { JsonObject } from "../shared/json"

function isServerNotification(
  value: ChannelNotification,
): value is ChannelNotification & ServerNotification {
  return typeof value.method === "string"
}

export interface ChannelNotification {
  method: "notifications/claude/channel"
  params: { content: string; meta: JsonObject; _meta?: JsonObject }
}

export function buildChannelNotification(
  content: string,
  meta: JsonObject = {},
): ChannelNotification {
  return {
    method: "notifications/claude/channel",
    params: { content, meta: { source: KANNA_MCP_SERVER_NAME, ...meta } },
  }
}

export interface KannaMcpHttpHandle {
  url: string
  bearerToken: string
  close: () => Promise<void>
  channelClientReady: Promise<void>
  pushChannelPrompt: (content: string, meta?: JsonObject) => Promise<void>
}

export interface StartKannaMcpHttpServerOptions {
  args: KannaMcpArgs
  host?: string
  port?: number
}

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
    registerSdkToolOnMcpServer(mcp, def)
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
    meta: JsonObject = {},
  ): Promise<void> => {
    const notification = buildChannelNotification(content, meta)
    try {
      if (isServerNotification(notification)) {
        await mcp.server.notification(notification)
      }
    } catch (err) {
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
    try { await transport.close() } catch { }
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


export function buildMcpConfigJson(
  handle: { url: string; bearerToken: string },
  userServers: readonly McpServerConfig[] = [],
  oauthBearers: ReadonlyMap<string, string> = new Map(),
): string {
  const mcpServers: Record<string, JsonObject> = {
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

function toClaudeCliMcpEntry(s: McpServerConfig, oauthBearer?: string): JsonObject {
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
