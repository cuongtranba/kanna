import { createHash } from "node:crypto"
import { SESSION_COOKIE_NAME, type AuthBackend, type RemoteMcpPrincipal } from "../auth-backend"

const MAX_CACHED_PASSWORDS = 32
const PASSWORD_CLIENT_ID = "password"
const PASSWORD_SCOPES = ["kanna"]
const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i

export type BearerVerdict =
  | { ok: true; principal: RemoteMcpPrincipal }
  | { ok: false; status: 401 | 429; retryAfter?: string }

export interface RemoteMcpBearerVerifierOptions {
  backend: Pick<AuthBackend, "getSession" | "verifyRemoteMcpToken">
  signInWithPassword: (password: string, clientIp: string | null) => Promise<Response>
}

export interface RemoteMcpBearerVerifier {
  verifyBearer(authorization: string | null, clientIp: string | null): Promise<BearerVerdict>
}

function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

function sessionCookiePair(response: Response): string | null {
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0]?.trim()
    if (pair?.startsWith(`${SESSION_COOKIE_NAME}=`)) return pair
  }
  return null
}

function passwordPrincipal(): RemoteMcpPrincipal {
  return { clientId: PASSWORD_CLIENT_ID, scopes: [...PASSWORD_SCOPES], expiresAt: null, via: "password" }
}

export function createRemoteMcpBearerVerifier(options: RemoteMcpBearerVerifierOptions): RemoteMcpBearerVerifier {
  const { backend, signInWithPassword } = options
  const sessionCookies = new Map<string, string>()

  function remember(key: string, cookie: string) {
    if (!sessionCookies.has(key) && sessionCookies.size >= MAX_CACHED_PASSWORDS) {
      const oldest = sessionCookies.keys().next()
      if (!oldest.done) sessionCookies.delete(oldest.value)
    }
    sessionCookies.set(key, cookie)
  }

  async function cachedSessionIsLive(key: string): Promise<boolean> {
    const cookie = sessionCookies.get(key)
    if (!cookie) return false
    const session = await backend.getSession(new Headers({ cookie }))
    if (session.authenticated) return true
    sessionCookies.delete(key)
    return false
  }

  async function verifyPassword(password: string, clientIp: string | null): Promise<BearerVerdict> {
    const key = fingerprint(password)
    if (await cachedSessionIsLive(key)) return { ok: true, principal: passwordPrincipal() }
    const response = await signInWithPassword(password, clientIp)
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after")
      return retryAfter ? { ok: false, status: 429, retryAfter } : { ok: false, status: 429 }
    }
    if (!response.ok) return { ok: false, status: 401 }
    const cookie = sessionCookiePair(response)
    if (!cookie) return { ok: false, status: 401 }
    remember(key, cookie)
    return { ok: true, principal: passwordPrincipal() }
  }

  async function verifyBearer(authorization: string | null, clientIp: string | null): Promise<BearerVerdict> {
    const value = authorization ? BEARER_PATTERN.exec(authorization)?.[1] : undefined
    if (!value) return { ok: false, status: 401 }
    const principal = await backend.verifyRemoteMcpToken(value)
    if (principal) return { ok: true, principal }
    return verifyPassword(value, clientIp)
  }

  return { verifyBearer }
}
