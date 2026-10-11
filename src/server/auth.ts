import { isJsonObject, type JsonValue } from "../shared/json"
import {
  CLIENT_IP_HEADER,
  OWNER_EMAIL,
  SESSION_COOKIE_NAME,
  SIGN_IN_PATH,
  type AuthBackend,
} from "./auth-backend"

export interface AuthStatusPayload {
  enabled: boolean
  authenticated: boolean
}

export interface AuthManager {
  isAuthenticated(req: Request): Promise<boolean>
  validateOrigin(req: Request): boolean
  redirectToApp(req: Request): Response
  handleLogin(req: Request, nextPath: string, clientIp: string | null): Promise<Response>
  signInForOAuth(req: Request, password: string, oauthQuery: string, clientIp: string | null): Promise<Response>
  handleLogout(req: Request): Promise<Response>
  handleStatus(req: Request): Promise<Response>
  dispose(): Promise<void>
}

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>()
  if (!header) return cookies

  for (const segment of header.split(";")) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    cookies.set(key, decodeURIComponent(value))
  }

  return cookies
}

function sanitizeNextPath(nextPath: string | null | undefined) {
  if (!nextPath || typeof nextPath !== "string") return "/"
  if (!nextPath.startsWith("/")) return "/"
  if (nextPath.startsWith("//")) return "/"
  if (nextPath.startsWith("/auth/login")) return "/"
  return nextPath
}

function forwardedProto(req: Request): "http" | "https" | null {
  const xfp = req.headers.get("x-forwarded-proto")
  if (!xfp) return null
  const value = xfp.split(",")[0]?.trim().toLowerCase()
  return value === "http" || value === "https" ? value : null
}

function effectiveOrigin(req: Request, trustProxy: boolean): string {
  const url = new URL(req.url)
  if (!trustProxy) return url.origin
  const proto = forwardedProto(req)
  const scheme = proto ?? url.protocol.replace(":", "")
  return `${scheme}://${url.host}`
}

function shouldUseSecureCookie(req: Request, trustProxy: boolean) {
  if (trustProxy) {
    const proto = forwardedProto(req)
    if (proto) return proto === "https"
  }
  return new URL(req.url).protocol === "https:"
}

function isLoopbackAddress(ip: string | null) {
  if (!ip) return false
  return ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.")
}

function buildCookie(name: string, value: string, maxAgeSeconds: number) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ")
}

async function readLoginForm(req: Request) {
  const contentType = req.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    const rawPayload = await req.json()
    const rawJson: JsonValue = rawPayload
    const payload: { password?: JsonValue; next?: JsonValue } = isJsonObject(rawJson) ? rawJson : {}
    return {
      password: typeof payload.password === "string" ? payload.password : "",
      nextPath: sanitizeNextPath(typeof payload.next === "string" ? payload.next : "/"),
    }
  }

  const formData = await req.formData()
  return {
    password: String(formData.get("password") ?? ""),
    nextPath: sanitizeNextPath(String(formData.get("next") ?? "/")),
  }
}

export interface SignInRequestArgs {
  req: Request
  trustProxy: boolean
  password: string
  clientIp: string | null
  oauthQuery?: string
}

export function buildSignInRequest({ req, trustProxy, password, clientIp, oauthQuery }: SignInRequestArgs): Request {
  const origin = effectiveOrigin(req, trustProxy)
  const headers = new Headers({
    "content-type": "application/json",
    origin,
  })
  const userAgent = req.headers.get("user-agent")
  if (userAgent) headers.set("user-agent", userAgent)
  if (clientIp) headers.set(CLIENT_IP_HEADER, clientIp)
  const body = oauthQuery === undefined
    ? { email: OWNER_EMAIL, password, rememberMe: true }
    : { email: OWNER_EMAIL, password, rememberMe: true, oauth_query: oauthQuery }
  return new Request(`${origin}${SIGN_IN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

export interface AuthManagerOptions {
  trustProxy?: boolean
}

export function isPublicSharePath(url: string): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }
  return pathname.startsWith("/share/")
    || pathname === "/share"
    || pathname.startsWith("/api/share/")
    || pathname.startsWith("/assets/share-view/")
}

export function createAuthManager(backend: AuthBackend, options: AuthManagerOptions = {}): AuthManager {
  const trustProxy = options.trustProxy ?? false

  function sessionHeaders(req: Request) {
    const headers = new Headers()
    const cookie = req.headers.get("cookie")
    if (cookie) headers.set("cookie", cookie)
    return headers
  }

  function hasSessionCookie(req: Request) {
    return parseCookies(req.headers.get("cookie")).has(SESSION_COOKIE_NAME)
  }

  function withSecureAttribute(req: Request, setCookie: string) {
    return shouldUseSecureCookie(req, trustProxy) ? `${setCookie}; Secure` : setCookie
  }

  function appendCookies(response: Response, req: Request, setCookies: string[]) {
    for (const setCookie of setCookies) {
      response.headers.append("Set-Cookie", withSecureAttribute(req, setCookie))
    }
    return response
  }

  async function readSession(req: Request) {
    if (!hasSessionCookie(req)) return { authenticated: false, setCookies: [] }
    return backend.getSession(sessionHeaders(req))
  }

  async function isAuthenticated(req: Request) {
    return (await readSession(req)).authenticated
  }

  function validateOrigin(req: Request) {
    const origin = req.headers.get("origin")
    if (!origin) return true
    if (origin === new URL(req.url).origin) return true
    if (!trustProxy) return false
    return origin === effectiveOrigin(req, trustProxy)
  }

  function resolveClientIp(req: Request, socketIp: string | null) {
    if (!trustProxy || !isLoopbackAddress(socketIp)) return socketIp
    const cloudflare = req.headers.get("cf-connecting-ip")?.trim()
    if (cloudflare) return cloudflare
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    return forwarded || socketIp
  }

  async function handleStatus(req: Request) {
    const session = await readSession(req)
    const response = Response.json({
      enabled: true,
      authenticated: session.authenticated,
    } satisfies AuthStatusPayload)
    return appendCookies(response, req, session.setCookies)
  }

  function redirectToApp(req: Request) {
    const currentUrl = new URL(req.url)
    return Response.redirect(new URL(sanitizeNextPath(currentUrl.searchParams.get("next")), effectiveOrigin(req, trustProxy)), 302)
  }

  async function handleLogin(req: Request, fallbackNextPath: string, socketIp: string | null) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { password, nextPath } = await readLoginForm(req)
    const upstream = await backend.signIn(
      buildSignInRequest({ req, trustProxy, password, clientIp: resolveClientIp(req, socketIp) }),
    )

    if (upstream.status === 429) {
      const limited = Response.json({ error: "Too many attempts" }, { status: 429 })
      const retryAfter = upstream.headers.get("retry-after")
      if (retryAfter) limited.headers.set("Retry-After", retryAfter)
      return limited
    }
    if (!upstream.ok) {
      return Response.json({ error: "Invalid password" }, { status: 401 })
    }

    const response = Response.json({ ok: true, nextPath: sanitizeNextPath(nextPath || fallbackNextPath) })
    return appendCookies(response, req, upstream.headers.getSetCookie())
  }

  async function signInForOAuth(req: Request, password: string, oauthQuery: string, socketIp: string | null) {
    const upstream = await backend.signIn(
      buildSignInRequest({ req, trustProxy, password, clientIp: resolveClientIp(req, socketIp), oauthQuery }),
    )
    const headers = new Headers(upstream.headers)
    headers.delete("set-cookie")
    const relayed = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
    return appendCookies(relayed, req, upstream.headers.getSetCookie())
  }

  async function handleLogout(req: Request) {
    if (!validateOrigin(req)) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const issued = hasSessionCookie(req) ? await backend.signOut(sessionHeaders(req)) : []
    const clearing = issued.length > 0 ? issued : [buildCookie(SESSION_COOKIE_NAME, "", 0)]
    return appendCookies(Response.json({ ok: true }), req, clearing)
  }

  async function dispose() {
    await backend.dispose()
  }

  return {
    isAuthenticated,
    validateOrigin,
    redirectToApp,
    handleLogin,
    signInForOAuth,
    handleLogout,
    handleStatus,
    dispose,
  }
}
