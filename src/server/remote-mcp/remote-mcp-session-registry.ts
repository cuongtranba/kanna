import { randomUUID } from "node:crypto"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { log } from "../../shared/log"
import { toError } from "../../shared/errors"

const SESSION_HEADER = "mcp-session-id"
const DEFAULT_IDLE_MS = 60 * 60 * 1000
const DEFAULT_MAX_SESSIONS = 64
const SWEEP_INTERVAL_MS = 60 * 1000
const SESSION_NOT_FOUND_CODE = -32001

interface McpSession {
  readonly server: McpServer
  readonly transport: WebStandardStreamableHTTPServerTransport
  lastSeenAt: number
}

export interface RemoteMcpSessionRegistryOptions {
  buildServer: () => McpServer
  now?: () => number
  idleMs?: number
  maxSessions?: number
}

export interface RemoteMcpSessionRegistry {
  handle(req: Request, authInfo: AuthInfo): Promise<Response>
  sweepIdle(): Promise<void>
  size(): number
  dispose(): Promise<void>
}

function sessionNotFound(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: SESSION_NOT_FOUND_CODE, message: "Session not found" }, id: null },
    { status: 404 },
  )
}

async function closeSession(session: McpSession): Promise<void> {
  try {
    await session.server.close()
  } catch (error) {
    log.warn("[remote-mcp] closing a session failed", toError(error).message)
  }
}

export function createRemoteMcpSessionRegistry(options: RemoteMcpSessionRegistryOptions): RemoteMcpSessionRegistry {
  const now = options.now ?? Date.now
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const sessions = new Map<string, McpSession>()

  function detach(sessionId: string): McpSession | null {
    const session = sessions.get(sessionId)
    if (!session) return null
    sessions.delete(sessionId)
    return session
  }

  async function evictOldest(): Promise<void> {
    let oldestId: string | null = null
    let oldestSeen = Number.POSITIVE_INFINITY
    for (const [sessionId, session] of sessions) {
      if (session.lastSeenAt < oldestSeen) {
        oldestSeen = session.lastSeenAt
        oldestId = sessionId
      }
    }
    const evicted = oldestId === null ? null : detach(oldestId)
    if (evicted) await closeSession(evicted)
  }

  async function startSession(req: Request, authInfo: AuthInfo): Promise<Response> {
    const server = options.buildServer()
    const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (sessionId) => {
        while (sessions.size >= maxSessions) await evictOldest()
        sessions.set(sessionId, { server, transport, lastSeenAt: now() })
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId)
      },
    })
    await server.connect(transport)
    const response = await transport.handleRequest(req, { authInfo })
    if (!transport.sessionId) await closeSession({ server, transport, lastSeenAt: now() })
    return response
  }

  async function handle(req: Request, authInfo: AuthInfo): Promise<Response> {
    const sessionId = req.headers.get(SESSION_HEADER)
    if (!sessionId) return startSession(req, authInfo)
    const session = sessions.get(sessionId)
    if (!session) return sessionNotFound()
    session.lastSeenAt = now()
    return session.transport.handleRequest(req, { authInfo })
  }

  async function sweepIdle(): Promise<void> {
    const cutoff = now() - idleMs
    for (const [sessionId, session] of [...sessions]) {
      if (session.lastSeenAt > cutoff) continue
      sessions.delete(sessionId)
      await closeSession(session)
    }
  }

  const sweepTimer = setInterval(() => void sweepIdle(), SWEEP_INTERVAL_MS)
  sweepTimer.unref()

  async function dispose(): Promise<void> {
    clearInterval(sweepTimer)
    const open = [...sessions.values()]
    sessions.clear()
    for (const session of open) await closeSession(session)
  }

  return { handle, sweepIdle, size: () => sessions.size, dispose }
}
