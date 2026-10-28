import type { AuthInfo, McpHttpHandler } from "@modelcontextprotocol/server"
import { CLIENT_IP_HEADER, type RemoteMcpPrincipal } from "../auth-backend"
import type { PasswordAuth } from "../better-auth.adapter"
import { handleOAuthPageRequest } from "./oauth-page-routes"
import { isRemoteMcpOAuthPath, OAUTH_PAGE_PATHS, REMOTE_MCP_PATH, remoteMcpOriginOf } from "./oauth-paths"
import type { RemoteMcpBearerVerifier } from "./remote-mcp-bearer"

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource"
const UNAUTHORIZED_CODE = -32000

export interface RemoteMcpRouteServices {
  auth: PasswordAuth | null
  enabled: () => boolean
  mcp: Pick<McpHttpHandler, "fetch">
  bearerVerifier: RemoteMcpBearerVerifier
  clientIp: string | null
  validateOrigin: (req: Request) => boolean
  holdConnectionOpen?: () => void
}

function ownsPath(pathname: string): boolean {
  return pathname === REMOTE_MCP_PATH || OAUTH_PAGE_PATHS.has(pathname) || isRemoteMcpOAuthPath(pathname)
}

function withTrustedClientIp(req: Request, clientIp: string | null): Request {
  const headers = new Headers(req.headers)
  headers.delete(CLIENT_IP_HEADER)
  if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp)
  return new Request(req, { headers })
}

function toAuthInfo(principal: RemoteMcpPrincipal): AuthInfo {
  const info: AuthInfo = { token: "", clientId: principal.clientId, scopes: principal.scopes }
  return principal.expiresAt === null ? info : { ...info, expiresAt: Math.floor(principal.expiresAt / 1000) }
}

function unauthorized(resource: string | null): Response {
  const headers = new Headers()
  if (resource) {
    const origin = remoteMcpOriginOf(resource)
    headers.set(
      "www-authenticate",
      `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE_METADATA_PATH}${REMOTE_MCP_PATH}"`,
    )
  }
  return Response.json(
    { jsonrpc: "2.0", error: { code: UNAUTHORIZED_CODE, message: "Unauthorized" }, id: null },
    { status: 401, headers },
  )
}

function tooManyAttempts(retryAfter: string | undefined): Response {
  const headers = new Headers()
  if (retryAfter) headers.set("retry-after", retryAfter)
  return Response.json(
    { jsonrpc: "2.0", error: { code: UNAUTHORIZED_CODE, message: "Too many attempts" }, id: null },
    { status: 429, headers },
  )
}

async function handleMcpRequest(req: Request, auth: PasswordAuth, services: RemoteMcpRouteServices): Promise<Response> {
  if (req.headers.get("origin") && !services.validateOrigin(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }
  const verdict = await services.bearerVerifier.verifyBearer(req.headers.get("authorization"), services.clientIp)
  if (verdict.ok) {
    services.holdConnectionOpen?.()
    return services.mcp.fetch(req, { authInfo: toAuthInfo(verdict.principal) })
  }
  if (verdict.status === 429) return tooManyAttempts(verdict.retryAfter)
  return unauthorized(auth.backend.remoteMcpResource())
}

export async function handleRemoteMcpRequest(
  req: Request,
  url: URL,
  services: RemoteMcpRouteServices,
): Promise<Response | null> {
  if (!ownsPath(url.pathname)) return null
  const { auth } = services
  if (auth === null) return Response.json({ error: "Remote MCP requires --password" }, { status: 404 })
  if (!services.enabled()) return Response.json({ error: "Remote MCP is disabled" }, { status: 404 })

  if (url.pathname === REMOTE_MCP_PATH) return handleMcpRequest(req, auth, services)
  if (OAUTH_PAGE_PATHS.has(url.pathname)) {
    return handleOAuthPageRequest(req, url, { auth, backend: auth.backend, clientIp: services.clientIp })
  }
  return auth.backend.handleOAuth(withTrustedClientIp(req, services.clientIp))
}
