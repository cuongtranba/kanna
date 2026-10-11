export const REMOTE_MCP_PATH = "/mcp"

const AUTH_PREFIX = "/api/auth"
const WELL_KNOWN_PREFIX = "/.well-known/"

const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  `${AUTH_PREFIX}/oauth2/authorize`,
  `${AUTH_PREFIX}/oauth2/token`,
  `${AUTH_PREFIX}/oauth2/register`,
  `${AUTH_PREFIX}/oauth2/revoke`,
  `${AUTH_PREFIX}/jwks`,
])

const ROOT_DISCOVERY: ReadonlySet<string> = new Set([
  "/.well-known/oauth-protected-resource",
  `/.well-known/oauth-protected-resource${REMOTE_MCP_PATH}`,
  "/.well-known/oauth-authorization-server",
  `/.well-known/oauth-authorization-server${AUTH_PREFIX}`,
  "/.well-known/openid-configuration",
  `/.well-known/openid-configuration${AUTH_PREFIX}`,
])

const BARE_REWRITES: ReadonlyMap<string, string> = new Map([
  ["/.well-known/oauth-authorization-server", `/.well-known/oauth-authorization-server${AUTH_PREFIX}`],
  ["/.well-known/openid-configuration", `${AUTH_PREFIX}/.well-known/openid-configuration`],
])

export function isRemoteMcpOAuthPath(pathname: string): boolean {
  if (AUTH_ENDPOINTS.has(pathname)) return true
  if (pathname.startsWith(`${AUTH_PREFIX}${WELL_KNOWN_PREFIX}`)) return true
  return ROOT_DISCOVERY.has(pathname)
}

export function rewriteBareDiscoveryPath(pathname: string): string {
  return BARE_REWRITES.get(pathname) ?? pathname
}
