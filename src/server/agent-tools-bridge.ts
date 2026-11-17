import { randomBytes } from "node:crypto"
import { errorMessage } from "../shared/errors"
import { isJsonObject, objectField, safeJsonParse, stringField, type JsonObject, type JsonValue } from "../shared/json"
import type { CodexKannaTools, KannaToolOutcome } from "./codex-dynamic-tool-call"

export const AGENT_TOOLS_MCP_PATH = "/agent-tools/mcp"
export const AGENT_TOOLS_SERVER_NAME = "kanna"

const OAUTH_DISCOVERY_PATH = `/.well-known/oauth-protected-resource${AGENT_TOOLS_MCP_PATH}`
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const BEHIND_PROXY_HEADERS: readonly string[] = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip"]
const DEFAULT_PROTOCOL_VERSION = "2025-03-26"
const TOKEN_BYTES = 32

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

export type AgentToolOutcomeListener = (tool: string, outcome: KannaToolOutcome) => void

export interface AgentToolsGrant {
  server: JsonObject
  serverName: string
  revoke(): void
}

interface GrantRecord {
  chatId: string
  onOutcome: AgentToolOutcomeListener
}

function rpcResult(id: JsonValue, result: JsonValue): Response {
  return Response.json({ jsonrpc: "2.0", id, result })
}

function rpcError(id: JsonValue, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } })
}

function bearerTokenOf(req: Request): string | null {
  const header = req.headers.get("authorization")
  if (header === null || !header.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length)
}

function isDirectLoopbackRequest(req: Request, socketIp: string | null): boolean {
  if (socketIp === null || !LOOPBACK_ADDRESSES.has(socketIp)) return false
  if (req.headers.has("origin")) return false
  return !BEHIND_PROXY_HEADERS.some((header) => req.headers.has(header))
}

export class AgentToolsBridge {
  private readonly grants = new Map<string, GrantRecord>()
  private port: number | null = null

  constructor(private readonly tools: CodexKannaTools) {}

  bindPort(port: number): void {
    this.port = port
  }

  grant(chatId: string, onOutcome: AgentToolOutcomeListener): AgentToolsGrant | null {
    if (this.port === null) return null
    const token = randomBytes(TOKEN_BYTES).toString("base64url")
    this.grants.set(token, { chatId, onOutcome })
    return {
      server: {
        type: "http",
        name: AGENT_TOOLS_SERVER_NAME,
        url: `http://127.0.0.1:${this.port}${AGENT_TOOLS_MCP_PATH}`,
        headers: [{ name: "Authorization", value: `Bearer ${token}` }],
      },
      serverName: AGENT_TOOLS_SERVER_NAME,
      revoke: () => {
        this.grants.delete(token)
      },
    }
  }

  async handle(
    req: Request,
    url: URL,
    socketIp: string | null,
    holdConnectionOpen: () => void,
  ): Promise<Response | null> {
    if (url.pathname === OAUTH_DISCOVERY_PATH) return new Response(null, { status: 404 })
    if (url.pathname !== AGENT_TOOLS_MCP_PATH) return null
    if (!isDirectLoopbackRequest(req, socketIp)) return new Response(null, { status: 403 })
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
    const token = bearerTokenOf(req)
    const grant = token === null ? undefined : this.grants.get(token)
    if (grant === undefined) return new Response(null, { status: 401 })

    holdConnectionOpen()
    const message = safeJsonParse(await req.text())
    if (message === null) return rpcError(null, PARSE_ERROR, "Parse error")
    if (!isJsonObject(message)) return rpcError(null, INVALID_REQUEST, "Invalid request")
    return this.dispatch(grant, message)
  }

  private async dispatch(grant: GrantRecord, message: JsonObject): Promise<Response> {
    const id = message.id
    if (id === undefined) return new Response(null, { status: 202 })
    const method = stringField(message, "method")
    const params = objectField(message, "params") ?? {}
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: stringField(params, "protocolVersion") ?? DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: AGENT_TOOLS_SERVER_NAME, version: "1" },
        })
      case "ping":
        return rpcResult(id, {})
      case "tools/list":
        return rpcResult(id, {
          tools: this.tools.specs.map((spec) => ({
            name: spec.name,
            description: spec.description,
            inputSchema: spec.inputSchema,
          })),
        })
      case "tools/call":
        return this.callTool(grant, id, params)
      default:
        return rpcError(id, METHOD_NOT_FOUND, "Method not found")
    }
  }

  private async callTool(grant: GrantRecord, id: JsonValue, params: JsonObject): Promise<Response> {
    const name = stringField(params, "name")
    if (name === undefined) return rpcError(id, INVALID_PARAMS, "Missing tool name")
    let outcome: KannaToolOutcome | null
    try {
      outcome = await this.tools.call(grant.chatId, name, params.arguments ?? {})
    } catch (error) {
      outcome = { text: errorMessage(error), isError: true }
    }
    if (outcome === null) return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`)
    grant.onOutcome(name, outcome)
    return rpcResult(id, { content: [{ type: "text", text: outcome.text }], isError: outcome.isError })
  }
}
