export const REMOTE_MCP_PATH = "/mcp"

export const AUTH_BASE_PATH = "/api/auth"

export const OAUTH_LOGIN_PATH = "/oauth/login"

export const OAUTH_CONSENT_PATH = "/oauth/consent"

export const OAUTH_PAGE_PATHS: ReadonlySet<string> = new Set([OAUTH_LOGIN_PATH, OAUTH_CONSENT_PATH])

export function remoteMcpResourceUrl(origin: string): string {
  return `${origin}${REMOTE_MCP_PATH}`
}

export function remoteMcpOriginOf(resource: string): string {
  return resource.slice(0, resource.length - REMOTE_MCP_PATH.length)
}
const WELL_KNOWN_PREFIX = "/.well-known/"

const AUTH_ENDPOINTS: ReadonlySet<string> = new Set([
  `${AUTH_BASE_PATH}/oauth2/authorize`,
  `${AUTH_BASE_PATH}/oauth2/token`,
  `${AUTH_BASE_PATH}/oauth2/register`,
  `${AUTH_BASE_PATH}/oauth2/revoke`,
  `${AUTH_BASE_PATH}/jwks`,
])

const ROOT_DISCOVERY: ReadonlySet<string> = new Set([
  "/.well-known/oauth-protected-resource",
  `/.well-known/oauth-protected-resource${REMOTE_MCP_PATH}`,
  "/.well-known/oauth-authorization-server",
  `/.well-known/oauth-authorization-server${AUTH_BASE_PATH}`,
  "/.well-known/openid-configuration",
  `/.well-known/openid-configuration${AUTH_BASE_PATH}`,
])

const BARE_REWRITES: ReadonlyMap<string, string> = new Map([
  ["/.well-known/oauth-authorization-server", `/.well-known/oauth-authorization-server${AUTH_BASE_PATH}`],
  ["/.well-known/openid-configuration", `${AUTH_BASE_PATH}/.well-known/openid-configuration`],
])

export function isRemoteMcpOAuthPath(pathname: string): boolean {
  if (AUTH_ENDPOINTS.has(pathname)) return true
  if (pathname.startsWith(`${AUTH_BASE_PATH}${WELL_KNOWN_PREFIX}`)) return true
  return ROOT_DISCOVERY.has(pathname)
}

export function rewriteBareDiscoveryPath(pathname: string): string {
  return BARE_REWRITES.get(pathname) ?? pathname
}
