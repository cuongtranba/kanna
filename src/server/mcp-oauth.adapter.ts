import {
  registerClient,
  startAuthorization,
  exchangeAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpServerConfig, McpOAuthState, McpServerTestResult } from "../shared/types"

const REDIRECT_URI = "http://localhost:8765/callback"

const CLIENT_METADATA: OAuthClientMetadata = {
  client_name: "Kanna MCP OAuth",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
}

export interface McpOAuthDeps {
  fetchFn?: typeof fetch
  persist: (oauth: McpOAuthState) => void
}

export type StartResult =
  | { kind: "authorizationUrl"; authorizationUrl: string }
  | { kind: "alreadyAuthenticated" }

function requireNetworkUrl(config: McpServerConfig): string {
  if (config.transport === "stdio") throw new Error("oauth not supported for stdio")
  return config.url
}

function resourceMetadataUrl(header: string | null, serverUrl: string): string {
  const m = header?.match(/resource_metadata="([^"]+)"/)
  if (m) return m[1]!
  const u = new URL(serverUrl)
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`
}

interface ResolvedAuthServer {
  issuer: string
  scope: string
  metadata: AuthorizationServerMetadata
}

async function resolveAuthServer(
  serverUrl: string,
  fetchFn: typeof fetch,
): Promise<ResolvedAuthServer> {
  // Fix 4: 10s timeout on all fetches
  const probe = await fetchFn(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    signal: AbortSignal.timeout(10_000),
  })
  // Fix 1: consume the probe response body to avoid a leaked socket
  await probe.body?.cancel()
  const prmUrl = resourceMetadataUrl(probe.headers.get("www-authenticate"), serverUrl)
  const prm = (await (await fetchFn(prmUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) })).json()) as {
    authorization_servers?: string[]
    scopes_supported?: string[]
  }
  const issuer = prm.authorization_servers?.[0]
  if (!issuer) throw new Error("protected-resource metadata has no authorization_servers")
  const scope = (prm.scopes_supported ?? []).join(" ")

  // Fix 2: expanded candidate list per RFC 8414 / OpenID Discovery.
  // We avoid the MCP SDK's discoverAuthorizationServerMetadata helper because
  // it tries RFC8414 path-aware URLs first and aborts on SPA HTML (e.g. claude.ai
  // returns 200 text/html for /.well-known/oauth-authorization-server/v1/design/mcp).
  const issuerClean = issuer.replace(/\/$/, "")
  const issuerUrl = new URL(issuer)
  const { origin, pathname } = issuerUrl
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const c of [
    `${origin}/.well-known/oauth-authorization-server${pathname}`,
    `${issuerClean}/.well-known/openid-configuration`,
    `${origin}/.well-known/openid-configuration${pathname}`,
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ]) {
    if (!seen.has(c)) { seen.add(c); candidates.push(c) }
  }

  for (const c of candidates) {
    const r = await fetchFn(c, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) })
    const ct = r.headers.get("content-type") ?? ""
    if (r.ok && ct.includes("json")) {
      const metadata = (await r.json()) as Record<string, unknown>
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return { issuer, scope, metadata: metadata as AuthorizationServerMetadata }
      }
    }
  }
  throw new Error("could not resolve authorization-server metadata")
}

export async function startMcpOAuth(
  config: McpServerConfig,
  deps: McpOAuthDeps,
): Promise<StartResult> {
  const fetchFn = deps.fetchFn ?? fetch
  // Fix 3: hoist serverUrl to top, reused for probe and resource param
  const serverUrl = requireNetworkUrl(config)
  const prev = config.transport === "stdio" ? undefined : config.oauth
  if (prev?.status === "authenticated" && prev.tokens) {
    return { kind: "alreadyAuthenticated" }
  }
  const { issuer, scope, metadata } = await resolveAuthServer(serverUrl, fetchFn)
  const existingClient = prev?.clientByIssuer?.[issuer]
  const client =
    existingClient ??
    (await registerClient(issuer, {
      metadata,
      clientMetadata: CLIENT_METADATA,
      scope,
      fetchFn,
    }))
  const state = crypto.randomUUID()
  const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
    metadata,
    clientInformation: client,
    redirectUrl: REDIRECT_URI,
    scope,
    state,
    resource: new URL(serverUrl),
  })
  const next: McpOAuthState = {
    enabled: true,
    status: "unauthenticated",
    issuer,
    clientByIssuer: { ...(prev?.clientByIssuer ?? {}), [issuer]: client },
    tokens: prev?.tokens,
    obtainedAt: prev?.obtainedAt,
    flow: {
      codeVerifier,
      state,
      issuer,
      authorizationUrl: authorizationUrl.toString(),
      metadata: metadata as Record<string, unknown>,
    },
  }
  deps.persist(next)
  return { kind: "authorizationUrl", authorizationUrl: authorizationUrl.toString() }
}

export interface CompleteDeps {
  fetchFn?: typeof fetch
  persist: (oauth: McpOAuthState) => void
  // injected so the adapter does not import the validator (avoids a cycle);
  // returns the tool count after a bearer-authenticated listTools.
  listTools: (serverUrl: string, accessToken: string) => Promise<number>
}

export async function completeMcpOAuth(
  config: McpServerConfig,
  callbackUrl: string,
  deps: CompleteDeps,
): Promise<McpServerTestResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const oauth = config.transport === "stdio" ? undefined : config.oauth
  const flow = oauth?.flow
  if (!oauth || !flow) throw new Error("no pending OAuth flow; start authentication first")
  const params = new URL(callbackUrl).searchParams
  if (params.get("state") !== flow.state) throw new Error("OAuth state mismatch (possible CSRF)")
  const code = params.get("code")
  if (!code) throw new Error("callback URL missing authorization code")
  const client = oauth.clientByIssuer?.[flow.issuer]
  if (!client) throw new Error("missing registered client for issuer")

  let tokens: OAuthTokens
  try {
    tokens = await exchangeAuthorization(flow.issuer, {
      metadata: flow.metadata as AuthorizationServerMetadata,
      clientInformation: client,
      authorizationCode: code,
      codeVerifier: flow.codeVerifier,
      redirectUri: REDIRECT_URI,
      resource: new URL(requireNetworkUrl(config)),
      fetchFn,
    })
  } catch {
    const next: McpOAuthState = { ...oauth, status: "error", errorMessage: "token exchange failed", flow: undefined }
    deps.persist(next)
    return { status: "error", testedAt: new Date().toISOString(), message: "token exchange failed" }
  }

  const toolCount = await deps.listTools(requireNetworkUrl(config), tokens.access_token)
  const next: McpOAuthState = {
    enabled: true,
    status: "authenticated",
    issuer: flow.issuer,
    clientByIssuer: oauth.clientByIssuer,
    tokens,
    obtainedAt: Date.now(),
    flow: undefined,
  }
  deps.persist(next)
  return { status: "ok", testedAt: new Date().toISOString(), toolCount }
}
