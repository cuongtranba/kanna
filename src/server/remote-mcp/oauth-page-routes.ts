import { isJsonObject, safeJsonParse } from "../../shared/json"
import type { AuthBackend } from "../auth-backend"
import type { AuthManager } from "../auth"
import { renderOAuthConsentPage, renderOAuthLoginPage } from "./oauth-pages"
import { OAUTH_CONSENT_PATH, OAUTH_LOGIN_PATH } from "./oauth-paths"

const DEFAULT_SCOPES = ["kanna"]
const UNKNOWN_CLIENT_NAME = "An application"
const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
}

export interface OAuthPageServices {
  auth: AuthManager
  backend: AuthBackend
  clientIp: string | null
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: PAGE_HEADERS })
}

function textResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
}

function redirectResponse(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append("set-cookie", cookie)
  return new Response(null, { status: 302, headers })
}

function sessionHeaders(req: Request): Headers {
  const headers = new Headers()
  const cookie = req.headers.get("cookie")
  if (cookie) headers.set("cookie", cookie)
  return headers
}

function signedQuery(url: URL): string {
  return url.search.startsWith("?") ? url.search.slice(1) : url.search
}

async function readForm(req: Request): Promise<FormData | null> {
  try {
    return await req.formData()
  } catch {
    return null
  }
}

function formString(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

async function upstreamRedirectTarget(upstream: Response): Promise<string | null> {
  const location = upstream.headers.get("location")
  if (upstream.status >= 300 && upstream.status < 400 && location) return location
  const body = safeJsonParse(await upstream.text())
  if (body && isJsonObject(body) && typeof body.url === "string") return body.url
  return null
}

async function renderLogin(services: OAuthPageServices, clientId: string, oauthQuery: string, error?: string, status = 200) {
  const client = await services.backend.describeOAuthClient({ clientId, oauthQuery })
  if (!client) return textResponse("Invalid authorization request", 400)
  const html = renderOAuthLoginPage({ clientName: client.name, oauthQuery, error })
  return htmlResponse(html, status)
}

async function showLogin(url: URL, services: OAuthPageServices): Promise<Response> {
  const clientId = url.searchParams.get("client_id")
  if (!clientId) return textResponse("Invalid authorization request", 400)
  return renderLogin(services, clientId, signedQuery(url))
}

async function submitLogin(req: Request, services: OAuthPageServices): Promise<Response> {
  if (!services.auth.validateOrigin(req)) return textResponse("Forbidden", 403)
  const form = await readForm(req)
  if (!form) return textResponse("Invalid form", 400)
  const oauthQuery = formString(form, "oauth_query")
  const clientId = new URLSearchParams(oauthQuery).get("client_id")
  if (!clientId) return textResponse("Invalid authorization request", 400)

  const upstream = await services.auth.signInForOAuth(req, formString(form, "password"), oauthQuery, services.clientIp)
  if (upstream.status === 429) {
    const limited = await renderLogin(services, clientId, oauthQuery, "Too many attempts. Try again shortly.", 429)
    const retryAfter = upstream.headers.get("retry-after")
    if (retryAfter) limited.headers.set("retry-after", retryAfter)
    return limited
  }
  if (!upstream.ok && !(upstream.status >= 300 && upstream.status < 400)) {
    return renderLogin(services, clientId, oauthQuery, "Incorrect password", 401)
  }
  const target = await upstreamRedirectTarget(upstream)
  if (!target) return textResponse("Sign-in did not return a redirect", 502)
  return redirectResponse(target, upstream.headers.getSetCookie())
}

async function showConsent(req: Request, url: URL, services: OAuthPageServices): Promise<Response> {
  const query = signedQuery(url)
  if (!(await services.auth.isAuthenticated(req))) return redirectResponse(`${OAUTH_LOGIN_PATH}?${query}`)
  const clientId = url.searchParams.get("client_id")
  if (!clientId) return textResponse("Invalid authorization request", 400)
  const client = await services.backend.describeOAuthClient({ headers: sessionHeaders(req), clientId, oauthQuery: query })
  const requestedScopes = (url.searchParams.get("scope") ?? "").split(" ").filter((scope) => scope.length > 0)
  return htmlResponse(renderOAuthConsentPage({
    clientName: client?.name ?? UNKNOWN_CLIENT_NAME,
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    scopes: requestedScopes.length > 0 ? requestedScopes : DEFAULT_SCOPES,
    oauthQuery: query,
  }))
}

async function submitConsent(req: Request, services: OAuthPageServices): Promise<Response> {
  if (!services.auth.validateOrigin(req)) return textResponse("Forbidden", 403)
  const form = await readForm(req)
  if (!form) return textResponse("Invalid form", 400)
  const outcome = await services.backend.consentForOAuth(
    sessionHeaders(req),
    formString(form, "oauth_query"),
    formString(form, "accept") === "true",
  )
  if ("error" in outcome) return textResponse(outcome.error, 400)
  return redirectResponse(outcome.redirectTo)
}

export async function handleOAuthPageRequest(
  req: Request,
  url: URL,
  services: OAuthPageServices,
): Promise<Response | null> {
  if (url.pathname === OAUTH_LOGIN_PATH) {
    if (req.method === "GET") return showLogin(url, services)
    if (req.method === "POST") return submitLogin(req, services)
    return textResponse("Method not allowed", 405)
  }
  if (url.pathname === OAUTH_CONSENT_PATH) {
    if (req.method === "GET") return showConsent(req, url, services)
    if (req.method === "POST") return submitConsent(req, services)
    return textResponse("Method not allowed", 405)
  }
  return null
}
