import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from "@modelcontextprotocol/client"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { isJsonObject, safeJsonParse } from "../../shared/json"
import { CLIENT_IP_HEADER } from "../auth-backend"
import { startKannaServer } from "../server"

const PASSWORD = "secret"
const FORM = "application/x-www-form-urlencoded"
const CALLBACK = "http://localhost:9999/cb"

type RunningServer = Awaited<ReturnType<typeof startKannaServer>>

interface Harness {
  server: RunningServer
  origin: string
  stop: () => Promise<void>
}

async function startHarness(options: { password?: string } = {}): Promise<Harness> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-mcp-data-"))
  const server = await startKannaServer({
    dataDir,
    port: 0,
    strictPort: false,
    password: options.password,
    trustProxy: false,
    discoverProjects: () => [],
  })
  return {
    server,
    origin: `http://127.0.0.1:${server.port}`,
    stop: async () => {
      await server.stop()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

function bearerTransport(origin: string, token: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function connectWithPassword(origin: string) {
  const client = new Client({ name: "test-client", version: "1.0.0" })
  const transport = bearerTransport(origin, PASSWORD)
  await client.connect(transport)
  return { client, transport }
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content
  if (!Array.isArray(content)) return ""
  const first = content[0]
  return first && first.type === "text" ? first.text : ""
}

class MemoryOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null
  private information: OAuthClientInformationMixed | undefined
  private stored: OAuthTokens | undefined
  private verifier = ""

  get redirectUrl(): string {
    return CALLBACK
  }

  get clientMetadata(): OAuthClientMetadata {
    const metadata = {
      client_name: "Test",
      redirect_uris: [CALLBACK],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }
    return metadata
  }

  clientInformation() {
    return this.information
  }

  saveClientInformation(information: OAuthClientInformationMixed) {
    this.information = information
  }

  tokens() {
    return this.stored
  }

  saveTokens(tokens: OAuthTokens) {
    this.stored = tokens
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier
  }

  codeVerifier() {
    return this.verifier
  }
}

function cookiePairOf(response: Response): string {
  const pair = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "").find((cookie) => cookie.startsWith("kanna_session="))
  if (!pair) throw new Error("no session cookie")
  return pair
}

function locationOf(response: Response, base: string): URL {
  const location = response.headers.get("location")
  if (!location) throw new Error(`no Location (status ${response.status})`)
  return new URL(location, base)
}

async function approveInBrowser(origin: string, authorizationUrl: URL): Promise<string> {
  const authorize = await fetch(authorizationUrl, { redirect: "manual" })
  const login = locationOf(authorize, origin)
  expect(login.pathname).toBe("/oauth/login")

  const signedIn = await fetch(`${origin}/oauth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": FORM, origin },
    body: new URLSearchParams({ password: PASSWORD, oauth_query: login.search.slice(1) }),
  })
  const consent = locationOf(signedIn, origin)
  expect(consent.pathname).toBe("/oauth/consent")

  const approved = await fetch(`${origin}/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": FORM, origin, cookie: cookiePairOf(signedIn) },
    body: new URLSearchParams({ accept: "true", oauth_query: consent.search.slice(1) }),
  })
  const code = locationOf(approved, origin).searchParams.get("code")
  if (!code) throw new Error("no authorization code")
  return code
}

describe("remote MCP gating", () => {
  test("without a password every owned path answers 404 and says why", async () => {
    const harness = await startHarness()
    try {
      const mcp = await fetch(`${harness.origin}/mcp`, { method: "POST" })
      expect(mcp.status).toBe(404)
      expect(await mcp.json()).toEqual({ error: "Remote MCP requires --password" })

      const metadata = await fetch(`${harness.origin}/.well-known/oauth-protected-resource/mcp`)
      expect(metadata.status).toBe(404)
    } finally {
      await harness.stop()
    }
  })

  test("with remoteMcp.enabled turned off the endpoint answers 404", async () => {
    const harness = await startHarness({ password: PASSWORD })
    try {
      await harness.server.appSettings.writePatch({ remoteMcp: { enabled: false } })

      const mcp = await fetch(`${harness.origin}/mcp`, { method: "POST" })

      expect(mcp.status).toBe(404)
      expect(await mcp.json()).toEqual({ error: "Remote MCP is disabled" })
    } finally {
      await harness.stop()
    }
  })

  test("a configured public url becomes the resource the metadata advertises", async () => {
    const harness = await startHarness({ password: PASSWORD })
    try {
      await harness.server.appSettings.writePatch({ remoteMcp: { publicUrl: "http://localhost:4999/ignored/path" } })

      const response = await fetch(`${harness.origin}/.well-known/oauth-protected-resource/mcp`)

      const metadata = safeJsonParse(await response.text())
      expect(metadata && isJsonObject(metadata) && metadata.resource).toBe("http://localhost:4999/mcp")
    } finally {
      await harness.stop()
    }
  })
})

describe("remote MCP over HTTP", () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness({ password: PASSWORD })
  })

  afterAll(async () => {
    await harness.stop()
  })

  test("an unauthenticated request is challenged with the protected-resource metadata url", async () => {
    const response = await fetch(`${harness.origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: "{}",
    })

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${harness.origin}/.well-known/oauth-protected-resource/mcp"`,
    )
  })

  test("discovery documents are served without a session", async () => {
    const resource = await fetch(`${harness.origin}/.well-known/oauth-protected-resource/mcp`)
    expect(resource.status).toBe(200)
    const metadata = safeJsonParse(await resource.text())
    expect(metadata && isJsonObject(metadata) && metadata.resource).toBe(`${harness.origin}/mcp`)

    const authorizationServer = await fetch(`${harness.origin}/.well-known/oauth-authorization-server/api/auth`)
    expect(authorizationServer.status).toBe(200)
  })

  test("the launch password works as a bearer and the generic tools run commands and reads", async () => {
    const { client } = await connectWithPassword(harness.origin)
    try {
      const tools = (await client.listTools()).tools.map((tool) => tool.name)
      expect(tools).toEqual(expect.arrayContaining(["kanna_command", "kanna_commands", "kanna_read", "ping"]))

      expect(textOf(await client.callTool({ name: "ping", arguments: {} }))).toBe("pong")

      const ack = await client.callTool({ name: "kanna_command", arguments: { type: "system.ping" } })
      expect(ack.isError).toBeFalsy()

      const sidebar = await client.callTool({ name: "kanna_read", arguments: { topic: { type: "sidebar" } } })
      const parsed = safeJsonParse(textOf(sidebar))
      expect(parsed && isJsonObject(parsed) && parsed.type).toBe("sidebar")

      const browserBound = await client.callTool({ name: "kanna_command", arguments: { type: "push.test" } })
      expect(browserBound.isError).toBe(true)
      expect(textOf(browserBound)).toContain("browser")

      const unknown = await client.callTool({ name: "kanna_command", arguments: { type: "nope.nothing" } })
      expect(unknown.isError).toBe(true)

      const catalog = safeJsonParse(textOf(await client.callTool({ name: "kanna_commands", arguments: { domain: "board" } })))
      expect(Array.isArray(catalog) && catalog.length).toBeGreaterThan(5)

      const resources = (await client.listResources()).resources.map((resource) => resource.uri)
      expect(resources).toContain("kanna://projects")
    } finally {
      await client.close()
    }
  })

  test("a 2026-07-28 client discovers the server without an initialize handshake and calls tools", async () => {
    const client = new ModernClient(
      { name: "modern-client", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    )
    await client.connect(
      new ModernTransport(new URL(`${harness.origin}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${PASSWORD}` } },
      }),
    )
    try {
      expect(client.getProtocolEra()).toBe("modern")
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28")

      const tools = (await client.listTools()).tools.map((tool) => tool.name)
      expect(tools).toEqual(expect.arrayContaining(["kanna_command", "kanna_read", "ping"]))

      const sidebar = await client.callTool({ name: "kanna_read", arguments: { topic: { type: "sidebar" } } })
      expect(sidebar.isError).toBeFalsy()
    } finally {
      await client.close()
    }
  })

  test("an OAuth client authorizes through the login and consent pages and calls tools with a JWT", async () => {
    const provider = new MemoryOAuthProvider()
    const first = new Client({ name: "oauth-client", version: "1.0.0" })
    const firstTransport = new StreamableHTTPClientTransport(new URL(`${harness.origin}/mcp`), { authProvider: provider })

    let unauthorized = false
    try {
      await first.connect(firstTransport)
    } catch (error) {
      unauthorized = error instanceof UnauthorizedError
    }
    expect(unauthorized).toBe(true)
    if (!provider.authorizationUrl) throw new Error("the client never asked for authorization")

    const code = await approveInBrowser(harness.origin, provider.authorizationUrl)
    await firstTransport.finishAuth(code)

    const second = new Client({ name: "oauth-client", version: "1.0.0" })
    await second.connect(new StreamableHTTPClientTransport(new URL(`${harness.origin}/mcp`), { authProvider: provider }))
    try {
      expect(textOf(await second.callTool({ name: "ping", arguments: {} }))).toBe("pong")
      const sidebar = await second.callTool({ name: "kanna_read", arguments: { topic: { type: "sidebar" } } })
      expect(sidebar.isError).toBeFalsy()
    } finally {
      await second.close()
    }
    expect(provider.tokens()?.access_token.split(".")).toHaveLength(3)
  })
})

describe("remote MCP credential throttling", () => {
  test("a wrong password is rejected with 401 and repeated attempts are throttled with 429", async () => {
    const harness = await startHarness({ password: PASSWORD })
    try {
      const rejected = new Client({ name: "wrong-client", version: "1.0.0" })
      let status: number | undefined
      try {
        await rejected.connect(bearerTransport(harness.origin, "wrong"))
      } catch (error) {
        status = error instanceof StreamableHTTPError ? error.code : undefined
      }
      expect(status).toBe(401)

      const statuses: number[] = []
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(`${harness.origin}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer wrong" },
          body: "{}",
        })
        statuses.push(response.status)
      }
      expect(statuses[0]).toBe(401)
      expect(statuses.at(-1)).toBe(429)
    } finally {
      await harness.stop()
    }
  })

  test("a forged x-kanna-client-ip header cannot evade the registration rate limit", async () => {
    const harness = await startHarness({ password: PASSWORD })
    try {
      const statuses: number[] = []
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await fetch(`${harness.origin}/api/auth/oauth2/register`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: harness.origin,
            [CLIENT_IP_HEADER]: `203.0.113.${attempt + 1}`,
          },
          body: JSON.stringify({
            client_name: "Forger",
            application_type: "native",
            redirect_uris: [CALLBACK],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code"],
            response_types: ["code"],
          }),
        })
        statuses.push(response.status)
      }

      expect(statuses[0]).toBeLessThan(300)
      expect(statuses).toContain(429)
    } finally {
      await harness.stop()
    }
  })
})
