import {
  registerClient,
  startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpServerConfig, McpOAuthState } from "../shared/types"

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
  metadata: Record<string, unknown>
}

async function resolveAuthServer(
  config: McpServerConfig,
  fetchFn: typeof fetch,
): Promise<ResolvedAuthServer> {
  const serverUrl = requireNetworkUrl(config)
  const probe = await fetchFn(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  })
  const prmUrl = resourceMetadataUrl(probe.headers.get("www-authenticate"), serverUrl)
  const prm = (await (await fetchFn(prmUrl, { headers: { accept: "application/json" } })).json()) as {
    authorization_servers?: string[]
    scopes_supported?: string[]
  }
  const issuer = prm.authorization_servers?.[0]
  if (!issuer) throw new Error("protected-resource metadata has no authorization_servers")
  const scope = (prm.scopes_supported ?? []).join(" ")
  const candidates = [
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname}`,
  ]
  for (const c of candidates) {
    const r = await fetchFn(c, { headers: { accept: "application/json" } })
    const ct = r.headers.get("content-type") ?? ""
    if (r.ok && ct.includes("json")) {
      const metadata = (await r.json()) as Record<string, unknown>
      if (metadata.authorization_endpoint && metadata.token_endpoint) {
        return { issuer, scope, metadata }
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
  const prev = config.transport === "stdio" ? undefined : config.oauth
  if (prev?.status === "authenticated" && prev.tokens) {
    return { kind: "alreadyAuthenticated" }
  }
  const { issuer, scope, metadata } = await resolveAuthServer(config, fetchFn)
  const existingClient = prev?.clientByIssuer?.[issuer]
  const client =
    existingClient ??
    (await registerClient(issuer, {
      metadata: metadata as never,
      clientMetadata: CLIENT_METADATA,
      scope,
      fetchFn,
    }))
  const state = crypto.randomUUID()
  const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
    metadata: metadata as never,
    clientInformation: client,
    redirectUrl: REDIRECT_URI,
    scope,
    state,
    resource: new URL(requireNetworkUrl(config)),
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
      metadata,
    },
  }
  deps.persist(next)
  return { kind: "authorizationUrl", authorizationUrl: authorizationUrl.toString() }
}
