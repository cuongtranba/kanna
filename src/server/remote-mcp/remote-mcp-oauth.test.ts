import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test"
import { createHash, randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { isJsonObject, safeJsonParse, type JsonObject } from "../../shared/json"
import { buildSignInRequest, createAuthManager, type AuthManager } from "../auth"
import { CLIENT_IP_HEADER, SESSION_COOKIE_NAME, type AuthBackend } from "../auth-backend"
import { createBetterAuthBackend, type BetterAuthBackend } from "../better-auth.adapter"
import { handleOAuthPageRequest, type OAuthPageServices } from "./oauth-page-routes"
import { createRemoteMcpBearerVerifier } from "./remote-mcp-bearer"

const ORIGIN = "http://127.0.0.1:4321"
const RESOURCE = `${ORIGIN}/mcp`
const ISSUER = `${ORIGIN}/api/auth`
const REDIRECT_URI = "http://localhost:9999/cb"
const PASSWORD = "secret"
const FORM = "application/x-www-form-urlencoded"

let dataDir = ""
let backend: BetterAuthBackend
let auth: AuthManager
let ipCounter = 0

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-mcp-oauth-"))
  backend = await createBetterAuthBackend({ dataDir, password: PASSWORD, getSessionMaxAgeDays: () => 30 })
  backend.configureRemoteMcp({ publicOrigin: ORIGIN })
  auth = createAuthManager(backend)
})

afterAll(async () => {
  await backend.dispose()
  await rm(dataDir, { recursive: true, force: true })
})

function freshIp(): string {
  ipCounter += 1
  return `10.20.30.${ipCounter}`
}

function servicesFor(clientIp: string): OAuthPageServices {
  return { auth, backend, clientIp }
}

function get(pathAndQuery: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${pathAndQuery}`, { headers })
}

function post(pathAndQuery: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${pathAndQuery}`, {
    method: "POST",
    body,
    headers: { "content-type": FORM, origin: ORIGIN, ...headers },
  })
}

async function readJson(response: Response): Promise<JsonObject> {
  const parsed = safeJsonParse(await response.text())
  if (!parsed || !isJsonObject(parsed)) throw new Error("expected a JSON object body")
  return parsed
}

function stringField(object: JsonObject, key: string): string {
  const value = object[key]
  if (typeof value !== "string") throw new Error(`expected string field ${key}`)
  return value
}

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

async function registerClient(): Promise<string> {
  const response = await requireHandled(new Request(`${ORIGIN}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, [CLIENT_IP_HEADER]: freshIp() },
    body: JSON.stringify({
      client_name: "Test",
      application_type: "native",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  }))
  expect([200, 201]).toContain(response.status)
  return stringField(await readJson(response), "client_id")
}

async function requireHandled(request: Request): Promise<Response> {
  const response = await backend.handleOAuth(request)
  if (!response) throw new Error(`handleOAuth declined ${request.url}`)
  return response
}

function authorizeUrl(clientId: string, challenge: string, resource = RESOURCE): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "kanna offline_access",
    state: "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  })
  return `/api/auth/oauth2/authorize?${query.toString()}`
}

function locationOf(response: Response): string {
  const location = response.headers.get("location")
  if (!location) throw new Error(`no Location header (status ${response.status})`)
  return location
}

function sessionCookieOf(response: Response): string {
  const pair = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
  if (!pair) throw new Error("no session cookie issued")
  return pair
}

async function pageResponse(request: Request, services: OAuthPageServices): Promise<Response> {
  const response = await handleOAuthPageRequest(request, new URL(request.url), services)
  if (!response) throw new Error(`page handler declined ${request.url}`)
  return response
}

interface Authorization {
  clientId: string
  verifier: string
  code: string
  cookie: string
}

async function authorizeThroughBrowser(resource = RESOURCE): Promise<Authorization> {
  const services = servicesFor(freshIp())
  const clientId = await registerClient()
  const { verifier, challenge } = pkcePair()
  const authorize = await requireHandled(get(authorizeUrl(clientId, challenge, resource)))
  const loginUrl = new URL(locationOf(authorize), ORIGIN)
  const login = await pageResponse(
    post("/oauth/login", new URLSearchParams({ password: PASSWORD, oauth_query: loginUrl.search.slice(1) }).toString()),
    services,
  )
  const cookie = sessionCookieOf(login)
  const consentUrl = new URL(locationOf(login), ORIGIN)
  const consent = await pageResponse(
    post(
      "/oauth/consent",
      new URLSearchParams({ accept: "true", oauth_query: consentUrl.search.slice(1) }).toString(),
      { cookie },
    ),
    services,
  )
  const callback = new URL(locationOf(consent))
  const code = callback.searchParams.get("code")
  if (!code) throw new Error(`no code in ${callback.toString()}`)
  return { clientId, verifier, code, cookie }
}

function tokenRequest(fields: Record<string, string>): Request {
  return post("/api/auth/oauth2/token", new URLSearchParams(fields).toString())
}

async function exchange(authorization: Authorization): Promise<JsonObject> {
  const response = await requireHandled(tokenRequest({
    grant_type: "authorization_code",
    code: authorization.code,
    code_verifier: authorization.verifier,
    redirect_uri: REDIRECT_URI,
    client_id: authorization.clientId,
    resource: RESOURCE,
  }))
  expect(response.status).toBe(200)
  return readJson(response)
}

describe("remote MCP discovery", () => {
  test("the protected-resource metadata names the MCP resource and this issuer", async () => {
    const response = await requireHandled(get("/.well-known/oauth-protected-resource/mcp"))

    expect(response.status).toBe(200)
    const metadata = await readJson(response)
    expect(metadata.resource).toBe(RESOURCE)
    expect(metadata.authorization_servers).toContain(ISSUER)
  })

  test("the authorization-server metadata is served at the path-aware and the bare root form", async () => {
    for (const pathname of ["/.well-known/oauth-authorization-server/api/auth", "/.well-known/oauth-authorization-server"]) {
      const response = await requireHandled(get(pathname))
      expect(response.status, pathname).toBe(200)
      const metadata = await readJson(response)
      expect(metadata.issuer).toBe(ISSUER)
      expect(metadata.authorization_endpoint).toBe(`${ISSUER}/oauth2/authorize`)
      expect(metadata.token_endpoint).toBe(`${ISSUER}/oauth2/token`)
      expect(metadata.registration_endpoint).toBe(`${ISSUER}/oauth2/register`)
      expect(metadata.code_challenge_methods_supported).toContain("S256")
    }
  })

  test("routes outside the OAuth allowlist are not handled", async () => {
    expect(await backend.handleOAuth(get("/api/auth/get-session"))).toBeNull()
    expect(await backend.handleOAuth(post("/api/auth/sign-up/email", "{}"))).toBeNull()
  })
})

describe("remote MCP authorization flow", () => {
  test("a client registers dynamically and the authorize request is sent to the login page", async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()

    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge)))

    expect(authorize.status).toBe(302)
    const location = new URL(locationOf(authorize), ORIGIN)
    expect(location.pathname).toBe("/oauth/login")
    expect(location.searchParams.get("client_id")).toBe(clientId)
  })

  test("the login page names the client, rejects a wrong password and resumes the flow on the right one", async () => {
    const services = servicesFor(freshIp())
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge)))
    const loginUrl = new URL(locationOf(authorize), ORIGIN)
    const oauthQuery = loginUrl.search.slice(1)

    const page = await pageResponse(get(`/oauth/login?${oauthQuery}`), services)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain("Test")
    expect(html).toContain('name="oauth_query"')

    const wrong = await pageResponse(
      post("/oauth/login", new URLSearchParams({ password: "nope", oauth_query: oauthQuery }).toString()),
      services,
    )
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toContain("Incorrect password")

    const right = await pageResponse(
      post("/oauth/login", new URLSearchParams({ password: PASSWORD, oauth_query: oauthQuery }).toString()),
      services,
    )
    expect(right.status).toBe(302)
    expect(new URL(locationOf(right), ORIGIN).pathname).toBe("/oauth/consent")
    expect(sessionCookieOf(right)).toContain(`${SESSION_COOKIE_NAME}=`)
  })

  test("the login page lets the browser send its own Origin on submit (no-referrer made every sign-in 403)", async () => {
    const services = servicesFor(freshIp())
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge)))
    const oauthQuery = new URL(locationOf(authorize), ORIGIN).search.slice(1)

    const page = await pageResponse(get(`/oauth/login?${oauthQuery}`), services)
    const html = await page.text()

    expect(html).toContain('<meta name="referrer" content="same-origin">')
    expect(html).not.toContain("no-referrer")
  })

  test("the consent page needs a session, names the client, and Allow returns an authorization code to the client", async () => {
    const services = servicesFor(freshIp())
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge)))
    const oauthQuery = new URL(locationOf(authorize), ORIGIN).search.slice(1)
    const login = await pageResponse(
      post("/oauth/login", new URLSearchParams({ password: PASSWORD, oauth_query: oauthQuery }).toString()),
      services,
    )
    const cookie = sessionCookieOf(login)
    const consentUrl = new URL(locationOf(login), ORIGIN)

    const anonymous = await pageResponse(get(`/oauth/consent${consentUrl.search}`), services)
    expect(anonymous.status).toBe(302)
    expect(new URL(locationOf(anonymous), ORIGIN).pathname).toBe("/oauth/login")

    const page = await pageResponse(get(`/oauth/consent${consentUrl.search}`, { cookie }), services)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("Test")

    const allowed = await pageResponse(
      post(
        "/oauth/consent",
        new URLSearchParams({ accept: "true", oauth_query: consentUrl.search.slice(1) }).toString(),
        { cookie },
      ),
      services,
    )
    expect(allowed.status).toBe(302)
    const callback = new URL(locationOf(allowed))
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
    expect(callback.searchParams.get("code")).toBeTruthy()
    expect(callback.searchParams.get("state")).toBe("state-1")
  })

  test("Deny sends the client back with access_denied", async () => {
    const services = servicesFor(freshIp())
    const clientId = await registerClient()
    const { challenge } = pkcePair()
    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge)))
    const login = await pageResponse(
      post(
        "/oauth/login",
        new URLSearchParams({
          password: PASSWORD,
          oauth_query: new URL(locationOf(authorize), ORIGIN).search.slice(1),
        }).toString(),
      ),
      services,
    )
    const consentQuery = new URL(locationOf(login), ORIGIN).search.slice(1)

    const denied = await pageResponse(
      post("/oauth/consent", new URLSearchParams({ accept: "false", oauth_query: consentQuery }).toString(), {
        cookie: sessionCookieOf(login),
      }),
      services,
    )

    expect(denied.status).toBe(302)
    expect(new URL(locationOf(denied)).searchParams.get("error")).toBe("access_denied")
  })
})

describe("remote MCP tokens", () => {
  test("the authorization code is exchanged for tokens that verify as an oauth principal", async () => {
    const authorization = await authorizeThroughBrowser()

    const tokens = await exchange(authorization)

    expect(tokens.token_type).toBe("Bearer")
    expect(stringField(tokens, "refresh_token").length).toBeGreaterThan(0)
    const principal = await backend.verifyRemoteMcpToken(stringField(tokens, "access_token"))
    expect(principal?.via).toBe("oauth")
    expect(principal?.clientId).toBe(authorization.clientId)
    expect(principal?.scopes).toContain("kanna")
    expect(principal?.expiresAt).toBeGreaterThan(Date.now())
  })

  test("something that is not an access token does not verify", async () => {
    expect(await backend.verifyRemoteMcpToken("not-a-jwt")).toBeNull()
  })

  test("the provider refuses to authorize a resource other than the MCP server", async () => {
    const clientId = await registerClient()
    const { challenge } = pkcePair()

    const authorize = await requireHandled(get(authorizeUrl(clientId, challenge, `${ORIGIN}/other`)))

    expect(authorize.status).toBe(302)
    const callback = new URL(locationOf(authorize))
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
    expect(callback.searchParams.get("error")).toBe("invalid_target")
    expect(callback.searchParams.get("code")).toBeNull()
  })

  test("a refresh token yields a new access token that verifies", async () => {
    const authorization = await authorizeThroughBrowser()
    const first = await exchange(authorization)

    const refreshed = await requireHandled(tokenRequest({
      grant_type: "refresh_token",
      refresh_token: stringField(first, "refresh_token"),
      client_id: authorization.clientId,
      resource: RESOURCE,
    }))

    expect(refreshed.status).toBe(200)
    const second = await readJson(refreshed)
    const principal = await backend.verifyRemoteMcpToken(stringField(second, "access_token"))
    expect(principal?.clientId).toBe(authorization.clientId)
  })
})

describe("remote MCP bearer verifier", () => {
  function verifierFor(counter: { calls: number }) {
    const synthetic = new Request(RESOURCE)
    return createRemoteMcpBearerVerifier({
      backend,
      signInWithPassword: (password, clientIp) => {
        counter.calls += 1
        return backend.signIn(buildSignInRequest({ req: synthetic, trustProxy: false, password, clientIp }))
      },
    })
  }

  test("an OAuth access token is accepted without touching the password path", async () => {
    const counter = { calls: 0 }
    const tokens = await exchange(await authorizeThroughBrowser())

    const verdict = await verifierFor(counter).verifyBearer(`Bearer ${stringField(tokens, "access_token")}`, freshIp())

    expect(verdict.ok && verdict.principal.via).toBe("oauth")
    expect(counter.calls).toBe(0)
  })

  test("the launch password is accepted and a repeat call reuses the cached session", async () => {
    const counter = { calls: 0 }
    const verifier = verifierFor(counter)
    const ip = freshIp()

    const first = await verifier.verifyBearer(`Bearer ${PASSWORD}`, ip)
    const second = await verifier.verifyBearer(`Bearer ${PASSWORD}`, ip)

    expect(first.ok && first.principal.via).toBe("password")
    expect(second.ok && second.principal.clientId).toBe("password")
    expect(counter.calls).toBe(1)
  })

  test("a wrong password, a missing header and a malformed header are all 401", async () => {
    const verifier = verifierFor({ calls: 0 })

    expect(await verifier.verifyBearer("Bearer wrong", freshIp())).toEqual({ ok: false, status: 401 })
    expect(await verifier.verifyBearer(null, null)).toEqual({ ok: false, status: 401 })
    expect(await verifier.verifyBearer("Basic abc", null)).toEqual({ ok: false, status: 401 })
  })

  test("repeated wrong passwords from one address are throttled and the 429 is relayed", async () => {
    const verifier = verifierFor({ calls: 0 })
    const ip = freshIp()
    const statuses: number[] = []

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const verdict = await verifier.verifyBearer("Bearer wrong", ip)
      statuses.push(verdict.ok ? 200 : verdict.status)
    }

    expect(statuses[0]).toBe(401)
    expect(statuses.at(-1)).toBe(429)
  })
})

describe("remote MCP origin configuration", () => {
  test("before an origin is configured there is no resource and no token verifies", async () => {
    const freshDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-mcp-unconfigured-"))
    const unconfigured = await createBetterAuthBackend({ dataDir: freshDir, password: PASSWORD, getSessionMaxAgeDays: () => 30 })
    try {
      expect(unconfigured.remoteMcpResource()).toBeNull()
      expect(await unconfigured.verifyRemoteMcpToken("anything")).toBeNull()
    } finally {
      await unconfigured.dispose()
      await rm(freshDir, { recursive: true, force: true })
    }
  })

  test("moving to another loopback origin rebuilds the resource and its metadata", async () => {
    const movingDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-mcp-moving-"))
    const moving = await createBetterAuthBackend({ dataDir: movingDir, password: PASSWORD, getSessionMaxAgeDays: () => 30 })
    try {
      moving.configureRemoteMcp({ publicOrigin: "http://127.0.0.1:5001" })
      moving.configureRemoteMcp({ publicOrigin: "http://127.0.0.1:5002" })

      expect(moving.remoteMcpResource()).toBe("http://127.0.0.1:5002/mcp")
      const metadata = await moving.handleOAuth(new Request("http://127.0.0.1:5002/.well-known/oauth-protected-resource/mcp"))
      expect((await readJson(metadata ?? new Response("{}"))).resource).toBe("http://127.0.0.1:5002/mcp")
    } finally {
      await moving.dispose()
      await rm(movingDir, { recursive: true, force: true })
    }
  })

  test("a non-loopback http origin is refused and the previous resource is kept", () => {
    const sink: AuthBackend = backend

    sink.configureRemoteMcp({ publicOrigin: "http://192.168.1.5:3210" })

    expect(sink.remoteMcpResource()).toBe(RESOURCE)
  })
})
