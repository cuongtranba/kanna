import { verifyJwsAccessToken } from "better-auth/oauth2"
import { toError } from "../shared/errors"
import { log } from "../shared/log"
import type {
  AuthBackend,
  OAuthClientDescription,
  OAuthConsentOutcome,
  RemoteMcpPrincipal,
} from "./auth-backend"
import type { KannaAuthInstance } from "./better-auth.adapter"
import { AUTH_BASE_PATH, isRemoteMcpOAuthPath, remoteMcpResourceUrl, rewriteBareDiscoveryPath } from "./remote-mcp/oauth-paths"

const DEFAULT_ORIGIN = "http://localhost"

export type OAuthPort = Pick<
  AuthBackend,
  "handleOAuth" | "consentForOAuth" | "describeOAuthClient" | "verifyRemoteMcpToken"
>

export interface OAuthPortSource {
  instance: () => KannaAuthInstance
  origin: () => string | null
}

function scopesOf(scope: string | string[] | undefined): string[] {
  if (Array.isArray(scope)) return scope
  return typeof scope === "string" ? scope.split(" ").filter((entry) => entry.length > 0) : []
}

function audienceOf(payload: { aud?: string | string[] }): string[] {
  if (Array.isArray(payload.aud)) return payload.aud
  return payload.aud ? [payload.aud] : []
}

export function createOAuthPort(source: OAuthPortSource): OAuthPort {
  const jwksCacheKeys = new WeakMap<KannaAuthInstance, object>()

  function cacheKeyFor(instance: KannaAuthInstance): object {
    const existing = jwksCacheKeys.get(instance)
    if (existing) return existing
    const created = {}
    jwksCacheKeys.set(instance, created)
    return created
  }

  return {
    async handleOAuth(request) {
      const url = new URL(request.url)
      if (!isRemoteMcpOAuthPath(url.pathname)) return null
      const rewritten = rewriteBareDiscoveryPath(url.pathname)
      if (rewritten === url.pathname) return source.instance().handler(request)
      url.pathname = rewritten
      return source.instance().handler(new Request(url, request))
    },

    async consentForOAuth(headers, oauthQuery, accept): Promise<OAuthConsentOutcome> {
      try {
        const origin = source.origin() ?? DEFAULT_ORIGIN
        const result = await source.instance().api.oauth2Consent({
          headers,
          body: { accept, oauth_query: oauthQuery },
          request: new Request(`${origin}${AUTH_BASE_PATH}/oauth2/consent`, { method: "POST", headers }),
          asResponse: false,
        })
        return { redirectTo: result.url }
      } catch (error) {
        return { error: toError(error).message }
      }
    },

    async describeOAuthClient({ headers, clientId, oauthQuery }): Promise<OAuthClientDescription | null> {
      const instance = source.instance()
      try {
        const client = headers
          ? await instance.api.getOAuthClientPublic({ headers, query: { client_id: clientId } })
          : await instance.api.getOAuthClientPublicPrelogin({
            body: { client_id: clientId, oauth_query: oauthQuery },
          })
        return { name: client.client_name ?? client.client_id, redirectUris: client.redirect_uris }
      } catch (error) {
        log.warn("[auth] could not describe OAuth client", toError(error).message)
        return null
      }
    },

    async verifyRemoteMcpToken(token): Promise<RemoteMcpPrincipal | null> {
      const origin = source.origin()
      if (!origin) return null
      const instance = source.instance()
      try {
        const payload = await verifyJwsAccessToken(token, {
          jwksFetch: async () => instance.api.getJwks(),
          jwksCacheKey: cacheKeyFor(instance),
          verifyOptions: { issuer: `${origin}${AUTH_BASE_PATH}`, audience: remoteMcpResourceUrl(origin) },
        })
        if (!audienceOf(payload).includes(remoteMcpResourceUrl(origin))) return null
        const clientId = typeof payload.azp === "string" ? payload.azp : null
        if (!clientId) return null
        return {
          clientId,
          scopes: scopesOf(typeof payload.scope === "string" ? payload.scope : undefined),
          expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null,
          via: "oauth",
        }
      } catch {
        return null
      }
    },
  }
}
