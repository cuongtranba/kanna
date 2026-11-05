import { BEACON_SOCKET_ROUTE } from "../shared/beacon-protocol"
import { TRANSFER_COMPLETE_ROUTE, TRANSFER_ROUTE } from "../shared/beacon-transfer"
import { API_PATH_PREFIX, HTTP_ROUTES } from "../shared/http-routes"
import { WEBHOOK_ROUTE_PATTERN } from "../shared/webhooks/types"
import { hasSessionCookie, originMatchesRequest } from "./auth"
import { isRemoteMcpOAuthPath, OAUTH_PAGE_PATHS, REMOTE_MCP_PATH } from "./remote-mcp/oauth-paths"

export interface RequestOriginGuardOptions {
  hasPassword: boolean
  trustProxy: boolean
  bindHost: string
}

const LOOPBACK_HOSTNAMES: readonly string[] = ["127.0.0.1", "localhost", "[::1]"]
const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"])
const OWN_ORIGIN_CHECK_PATHS: ReadonlySet<string> = new Set([
  HTTP_ROUTES.authStatus.path,
  HTTP_ROUTES.authLogin.path,
  HTTP_ROUTES.authLogout.path,
])
const SOCKET_PATHS: ReadonlySet<string> = new Set([HTTP_ROUTES.websocket.path, BEACON_SOCKET_ROUTE])
const BEARER_OR_SECRET_PATHS: ReadonlySet<string> = new Set([REMOTE_MCP_PATH, TRANSFER_ROUTE, TRANSFER_COMPLETE_ROUTE])
const SAME_ORIGIN_FETCH_SITES: ReadonlySet<string> = new Set(["same-origin", "none"])

function normalizeHostname(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
}

function isLoopbackBind(bindHost: string): boolean {
  return LOOPBACK_HOSTNAMES.includes(normalizeHostname(bindHost)) || bindHost.startsWith("127.")
}

function requestHostname(req: Request, url: URL): string | null {
  try {
    return new URL(`http://${req.headers.get("host") ?? url.host}`).hostname
  } catch {
    return null
  }
}

function ownsItsAuthentication(pathname: string): boolean {
  return (
    OWN_ORIGIN_CHECK_PATHS.has(pathname) ||
    BEARER_OR_SECRET_PATHS.has(pathname) ||
    OAUTH_PAGE_PATHS.has(pathname) ||
    isRemoteMcpOAuthPath(pathname) ||
    WEBHOOK_ROUTE_PATTERN.test(pathname)
  )
}

export function unprotectedExposureWarning(options: RequestOriginGuardOptions): string | null {
  if (options.hasPassword) return null
  if (!options.trustProxy && isLoopbackBind(options.bindHost)) return null
  return `[kanna] listening on ${options.bindHost} with no password: anyone who can reach this port can drive Kanna, and the Host check is off. Start with --password, or keep the default 127.0.0.1 bind.`
}

export function createRequestOriginGuard(
  options: RequestOriginGuardOptions,
): (req: Request, url: URL) => Response | null {
  const { hasPassword, trustProxy } = options
  const allowedHostnames: ReadonlySet<string> | null =
    hasPassword || trustProxy || !isLoopbackBind(options.bindHost)
      ? null
      : new Set([...LOOPBACK_HOSTNAMES, normalizeHostname(options.bindHost)])

  function isCrossOrigin(req: Request): boolean {
    const origin = req.headers.get("origin")
    return origin !== null && !originMatchesRequest(origin, req, trustProxy)
  }

  function isCrossSiteApiWrite(req: Request): boolean {
    const fetchSite = req.headers.get("sec-fetch-site")
    if (fetchSite !== null) return !SAME_ORIGIN_FETCH_SITES.has(fetchSite)
    if (req.headers.has("origin")) return isCrossOrigin(req)
    return hasPassword && hasSessionCookie(req)
  }

  return function guard(req, url) {
    const { pathname } = url
    if (ownsItsAuthentication(pathname)) return null

    if (allowedHostnames !== null) {
      const hostname = requestHostname(req, url)
      if (hostname === null || !allowedHostnames.has(hostname)) {
        return new Response("Host not allowed", { status: 403 })
      }
    }

    if (SOCKET_PATHS.has(pathname)) {
      return isCrossOrigin(req) ? new Response("Forbidden", { status: 403 }) : null
    }

    if (pathname.startsWith(API_PATH_PREFIX) && UNSAFE_METHODS.has(req.method) && isCrossSiteApiWrite(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    return null
  }
}
