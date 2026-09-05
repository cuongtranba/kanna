import { test, expect } from "bun:test"
import { startMcpOAuth, ensureFreshMcpToken } from "./mcp-oauth.adapter"
import type { McpServerConfig, McpOAuthState } from "../shared/types"
import type { OAuthClientInformationFull, OAuthTokens, AuthorizationServerMetadata } from "@modelcontextprotocol/sdk/shared/auth.js"

function baseConfig(): McpServerConfig {
  return {
    id: "s1",
    name: "design",
    enabled: true,
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.test/v1/mcp",
    headers: {},
    oauth: { enabled: true, status: "unauthenticated" },
  }
}

function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    if (url === "https://example.test/v1/mcp" && init?.method === "POST" && !(init.headers as Record<string, string>)?.Authorization) {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.test/v1/.well-known/oauth-protected-resource"',
        },
      })
    }
    if (url === "https://example.test/v1/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: ["https://as.test/v1/mcp"], scopes_supported: ["a", "b"] })
    }
    if (url === "https://as.test/.well-known/oauth-authorization-server/v1/mcp") {
      return new Response("not found", { status: 404 })
    }
    if (url === "https://as.test/v1/mcp/.well-known/openid-configuration") {
      return json({
        issuer: "https://as.test/v1/mcp",
        authorization_endpoint: "https://as.test/oauth/authorize",
        token_endpoint: "https://as.test/oauth/token",
        registration_endpoint: "https://as.test/oauth/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      })
    }
    if (url === "https://as.test/oauth/register") {
      return json({ client_id: "client-123", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error(`unexpected fetch: ${  url}`)
  }) as unknown as typeof fetch
}

test("startMcpOAuth discovers AS, registers, and returns an authorization URL", async () => {
  const cfg = baseConfig()
  const persisted: McpOAuthState[] = []
  const result = await startMcpOAuth(cfg, {
    fetchFn: fakeFetch(),
    persist: (oauth: McpOAuthState) => persisted.push(oauth),
  })
  expect(result.kind).toBe("authorizationUrl")
  if (result.kind !== "authorizationUrl") throw new Error("unreachable")
  const u = new URL(result.authorizationUrl)
  expect(u.origin + u.pathname).toBe("https://as.test/oauth/authorize")
  expect(u.searchParams.get("client_id")).toBe("client-123")
  expect(u.searchParams.get("code_challenge_method")).toBe("S256")
  expect(u.searchParams.get("resource")).toBe("https://example.test/v1/mcp")
  const last = persisted.at(-1)
  expect(typeof last?.flow?.state).toBe("string")
  expect((last?.flow?.state ?? "").length).toBeGreaterThan(20)
  expect(typeof last?.flow?.codeVerifier).toBe("string")
  expect((last?.flow?.codeVerifier ?? "").length).toBeGreaterThan(20)
  expect(last?.issuer).toBe("https://as.test/v1/mcp")
})

test("startMcpOAuth returns alreadyAuthenticated when tokens are present", async () => {
  const cfg: McpServerConfig = {
    id: "s1",
    name: "design",
    enabled: true,
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.test/v1/mcp",
    headers: {},
    oauth: {
      enabled: true,
      status: "authenticated",
      tokens: {
        access_token: "tok",
        token_type: "Bearer",
      },
    },
  }
  const fetchThatThrows = (() => {
    throw new Error("fetch must not be called for alreadyAuthenticated")
  }) as unknown as typeof fetch

  const result = await startMcpOAuth(cfg, {
    fetchFn: fetchThatThrows,
    persist: (_oauth: McpOAuthState) => { },
  })
  expect(result.kind).toBe("alreadyAuthenticated")
})

test("startMcpOAuth falls through SPA-HTML candidate to working openid-config", async () => {
  const spaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

    if (url === "https://example.test/v1/mcp" && init?.method === "POST") {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.test/v1/.well-known/oauth-protected-resource"',
        },
      })
    }
    if (url === "https://example.test/v1/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: ["https://as.test/"], scopes_supported: ["read"] })
    }
    if (url === "https://as.test/.well-known/oauth-authorization-server/") {
      return new Response("<html>SPA</html>", { status: 200, headers: { "content-type": "text/html" } })
    }
    if (url === "https://as.test/.well-known/openid-configuration") {
      return json({
        issuer: "https://as.test/",
        authorization_endpoint: "https://as.test/oauth/authorize",
        token_endpoint: "https://as.test/oauth/token",
        registration_endpoint: "https://as.test/oauth/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      })
    }
    if (url === "https://as.test/oauth/register") {
      return json({ client_id: "spa-client", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error(`unexpected fetch in spaFetch: ${  url}`)
  }) as unknown as typeof fetch

  const cfg = baseConfig()
  const persisted: McpOAuthState[] = []
  const result = await startMcpOAuth(cfg, {
    fetchFn: spaFetch,
    persist: (oauth: McpOAuthState) => persisted.push(oauth),
  })
  expect(result.kind).toBe("authorizationUrl")
  if (result.kind !== "authorizationUrl") throw new Error("unreachable")
  const u = new URL(result.authorizationUrl)
  expect(u.origin + u.pathname).toBe("https://as.test/oauth/authorize")
  expect(persisted.at(-1)?.issuer).toBe("https://as.test/")
})

test("startMcpOAuth derives PRM URL from serverUrl when www-authenticate header is absent", async () => {
  const noHeaderFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

    if (url === "https://example.test/v1/mcp" && init?.method === "POST") {
      return new Response("unauthorized", { status: 401 })
    }
    if (url === "https://example.test/.well-known/oauth-protected-resource/v1/mcp") {
      return json({ authorization_servers: ["https://as2.test/"], scopes_supported: ["openid"] })
    }
    if (url === "https://as2.test/.well-known/oauth-authorization-server/") {
      return new Response("not found", { status: 404 })
    }
    if (url === "https://as2.test/.well-known/openid-configuration") {
      return json({
        issuer: "https://as2.test/",
        authorization_endpoint: "https://as2.test/oauth/authorize",
        token_endpoint: "https://as2.test/oauth/token",
        registration_endpoint: "https://as2.test/oauth/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      })
    }
    if (url === "https://as2.test/oauth/register") {
      return json({ client_id: "no-header-client", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error(`unexpected fetch in noHeaderFetch: ${  url}`)
  }) as unknown as typeof fetch

  const cfg = baseConfig()
  const persisted: McpOAuthState[] = []
  const result = await startMcpOAuth(cfg, {
    fetchFn: noHeaderFetch,
    persist: (oauth: McpOAuthState) => persisted.push(oauth),
  })
  expect(result.kind).toBe("authorizationUrl")
  if (result.kind !== "authorizationUrl") throw new Error("unreachable")
  const u = new URL(result.authorizationUrl)
  expect(u.origin + u.pathname).toBe("https://as2.test/oauth/authorize")
  expect(persisted.at(-1)?.issuer).toBe("https://as2.test/")
})

import { completeMcpOAuth } from "./mcp-oauth.adapter"

function authedConfigWithFlow(): McpServerConfig {
  return {
    id: "s1",
    name: "design",
    enabled: true,
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    lastTest: { status: "untested" },
    transport: "http",
    url: "https://example.test/v1/mcp",
    headers: {},
    oauth: {
      enabled: true,
      status: "unauthenticated",
      issuer: "https://as.test/v1/mcp",
      clientByIssuer: {
        "https://as.test/v1/mcp": { client_id: "client-123", redirect_uris: ["http://localhost:8765/callback"] } as unknown as OAuthClientInformationFull,
      },
      flow: {
        codeVerifier: "verifier-xyz",
        state: "state-abc",
        issuer: "https://as.test/v1/mcp",
        authorizationUrl: "https://as.test/oauth/authorize?...",
        metadata: {
          issuer: "https://as.test/v1/mcp",
          authorization_endpoint: "https://as.test/oauth/authorize",
          token_endpoint: "https://as.test/oauth/token",
        } as unknown as AuthorizationServerMetadata,
      },
    },
  }
}

function tokenFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "https://as.test/oauth/token") {
      return new Response(
        JSON.stringify({ access_token: "AT", refresh_token: "RT", token_type: "Bearer", expires_in: 28800, scope: "a b" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    throw new Error(`unexpected fetch: ${  url}`)
  }) as unknown as typeof fetch
}

test("completeMcpOAuth rejects on state mismatch", async () => {
  const cfg = authedConfigWithFlow()
  await expect(
    completeMcpOAuth(cfg, "http://localhost:8765/callback?code=C&state=WRONG", {
      fetchFn: tokenFetch(),
      persist: () => {},
      listTools: async () => 20,
    }),
  ).rejects.toThrow(/state/i)
})

test("completeMcpOAuth exchanges code, persists tokens, returns ok", async () => {
  const cfg = authedConfigWithFlow()
  let saved: McpOAuthState | undefined
  const result = await completeMcpOAuth(cfg, "http://localhost:8765/callback?code=C&state=state-abc", {
    fetchFn: tokenFetch(),
    persist: (o: McpOAuthState) => { saved = o },
    listTools: async () => 20,
  })
  expect(result.status).toBe("ok")
  if (result.status !== "ok") throw new Error("unreachable")
  expect(result.toolCount).toBe(20)
  expect(saved?.status).toBe("authenticated")
  expect(saved?.issuer).toBe("https://as.test/v1/mcp")
  expect(saved?.tokens?.access_token).toBe("AT")
  expect(saved?.tokens?.refresh_token).toBe("RT")
  expect(saved?.flow).toBeUndefined()
})


test("completeMcpOAuth returns error and persists error state when token exchange fails", async () => {
  const cfg = authedConfigWithFlow()
  const persistedStates: McpOAuthState[] = []
  const failingFetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "https://as.test/oauth/token") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`unexpected fetch: ${  url}`)
  }) as unknown as typeof fetch

  const result = await completeMcpOAuth(
    cfg,
    "http://localhost:8765/callback?code=C&state=state-abc",
    {
      fetchFn: failingFetch,
      persist: (o: McpOAuthState) => { persistedStates.push(o) },
      listTools: async () => { throw new Error("should not be called") },
    },
  )
  expect(result.status).toBe("error")
  expect(persistedStates.length).toBeGreaterThan(0)
  const last = persistedStates.at(-1)!
  expect(last.status).toBe("error")
  expect(last.flow).toBeUndefined()
})

test("completeMcpOAuth rejects when callback URL has no code", async () => {
  const cfg = authedConfigWithFlow()
  await expect(
    completeMcpOAuth(
      cfg,
      "http://localhost:8765/callback?state=state-abc",
      {
        fetchFn: tokenFetch(),
        persist: () => {},
        listTools: async () => 0,
      },
    ),
  ).rejects.toThrow(/code/i)
})

test("completeMcpOAuth rejects when no registered client for issuer", async () => {
  const cfg = authedConfigWithFlow()
  if (cfg.transport !== "stdio" && cfg.oauth) {
    cfg.oauth = { ...cfg.oauth, clientByIssuer: {} }
  }
  await expect(
    completeMcpOAuth(
      cfg,
      "http://localhost:8765/callback?code=C&state=state-abc",
      {
        fetchFn: tokenFetch(),
        persist: () => {},
        listTools: async () => 0,
      },
    ),
  ).rejects.toThrow(/client/i)
})

test("completeMcpOAuth keeps tokens when listTools throws (Fix 1)", async () => {
  const cfg = authedConfigWithFlow()
  const persistedStates: McpOAuthState[] = []
  const result = await completeMcpOAuth(
    cfg,
    "http://localhost:8765/callback?code=C&state=state-abc",
    {
      fetchFn: tokenFetch(),
      persist: (o: McpOAuthState) => { persistedStates.push(o) },
      listTools: async () => { throw new Error("connection refused") },
    },
  )
  expect(result.status).toBe("error")
  if (result.status !== "error") throw new Error("unreachable")
  expect(result.message).toMatch(/tool check failed/)
  const last = persistedStates.at(-1)!
  expect(last.status).toBe("authenticated")
  expect(last.tokens?.access_token).toBe("AT")
})

function authedTokenConfig(obtainedAt: number, expiresIn: number, accessToken = "OLD"): McpServerConfig {
  const c = authedConfigWithFlow()
  if (c.transport !== "stdio") {
    c.oauth = {
      enabled: true,
      status: "authenticated",
      issuer: "https://as.test/v1/mcp",
      clientByIssuer: {
        "https://as.test/v1/mcp": { client_id: "client-123", redirect_uris: [new URL("http://localhost:8765/callback")] } as unknown as OAuthClientInformationFull,
      },
      tokens: { access_token: accessToken, refresh_token: "RT", token_type: "Bearer", expires_in: expiresIn } as unknown as OAuthTokens,
      obtainedAt,
    }
  }
  return c
}

test("ensureFreshMcpToken returns cached token when still valid", async () => {
  const cfg = authedTokenConfig(Date.now(), 28800)
  let persisted = false
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: (() => { throw new Error("should not refresh") }) as unknown as typeof fetch,
    persist: () => { persisted = true },
    metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata },
  })
  expect(token).toBe("OLD")
  expect(persisted).toBe(false)
})

test("ensureFreshMcpToken refreshes and persists rotated tokens when expired", async () => {
  const cfg = authedTokenConfig(Date.now() - 30000 * 1000, 28800)
  let saved: McpOAuthState | undefined
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: tokenFetch(),
    persist: (o: McpOAuthState) => { saved = o },
    metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata },
  })
  expect(token).toBe("AT")
  expect(saved?.status).toBe("authenticated")
  expect(saved?.tokens?.access_token).toBe("AT")
  expect(saved?.tokens?.refresh_token).toBe("RT")
  expect(saved?.obtainedAt).toBeGreaterThan(0)
})

test("ensureFreshMcpToken throws when not authenticated", async () => {
  const cfg = baseConfig()
  await expect(
    ensureFreshMcpToken(cfg, { persist: () => {}, metadataByIssuer: {} }),
  ).rejects.toThrow(/not authenticated/i)
})

test("ensureFreshMcpToken throws when expired and no refresh_token", async () => {
  const cfg = authedTokenConfig(Date.now() - 30000 * 1000, 100, "EXPIRED")
  if (cfg.transport !== "stdio" && cfg.oauth) {
    const { refresh_token: _dropped, ...tokensWithoutRefresh } = cfg.oauth.tokens as OAuthTokens & { refresh_token?: string }
    cfg.oauth = {
      ...cfg.oauth,
      tokens: tokensWithoutRefresh as OAuthTokens,
    }
  }
  await expect(
    ensureFreshMcpToken(cfg, {
      fetchFn: (() => { throw new Error("should not fetch") }) as unknown as typeof fetch,
      persist: () => {},
      metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata },
    }),
  ).rejects.toThrow(/no refresh token/i)
})

test("ensureFreshMcpToken persists error state when refresh endpoint returns error", async () => {
  const cfg = authedTokenConfig(Date.now() - 30000 * 1000, 100, "STALE")
  const failRefreshFetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url === "https://as.test/oauth/token") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`unexpected fetch: ${  url}`)
  }) as unknown as typeof fetch

  const persistedStates: McpOAuthState[] = []
  await expect(
    ensureFreshMcpToken(cfg, {
      fetchFn: failRefreshFetch,
      persist: (o: McpOAuthState) => { persistedStates.push(o) },
      metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata },
    }),
  ).rejects.toThrow()
  expect(persistedStates.length).toBeGreaterThan(0)
  expect(persistedStates.at(-1)!.status).toBe("error")
})

test("ensureFreshMcpToken returns cached token without refresh when expires_in is absent", async () => {
  const cfg = authedTokenConfig(Date.now() - 30000 * 1000, 0, "FOREVER")
  if (cfg.transport !== "stdio" && cfg.oauth) {
    const { expires_in: _dropped, ...tokensWithoutExpiry } = cfg.oauth.tokens as OAuthTokens & { expires_in?: number }
    cfg.oauth = {
      ...cfg.oauth,
      tokens: tokensWithoutExpiry as OAuthTokens,
    }
  }

  const fetchThatThrows = (() => {
    throw new Error("fetch must not be called for non-expiring token")
  }) as unknown as typeof fetch

  let persistCalled = false
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: fetchThatThrows,
    persist: () => { persistCalled = true },
    metadataByIssuer: { "https://as.test/v1/mcp": { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata },
  })
  expect(token).toBe("FOREVER")
  expect(persistCalled).toBe(false)
})

test("completeMcpOAuth persists AS metadata for later refresh", async () => {
  const cfg = authedConfigWithFlow()
  let saved: McpOAuthState | undefined
  await completeMcpOAuth(cfg, "http://localhost:8765/callback?code=C&state=state-abc", {
    fetchFn: tokenFetch(),
    persist: (o: McpOAuthState) => { saved = o },
    listTools: async () => 20,
  })
  expect(saved?.metadata).toBeDefined()
  expect((saved?.metadata as { token_endpoint?: string }).token_endpoint).toBe("https://as.test/oauth/token")
})

test("ensureFreshMcpToken refreshes using persisted oauth.metadata when metadataByIssuer is absent", async () => {
  const cfg = authedTokenConfig(Date.now() - 30000 * 1000, 28800)
  if (cfg.transport !== "stdio" && cfg.oauth) {
    cfg.oauth = {
      ...cfg.oauth,
      metadata: { token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata,
    }
  }
  let saved: McpOAuthState | undefined
  const token = await ensureFreshMcpToken(cfg, {
    fetchFn: tokenFetch(),
    persist: (o: McpOAuthState) => { saved = o },
  })
  expect(token).toBe("AT")
  expect(saved?.status).toBe("authenticated")
  expect(saved?.metadata).toEqual({ token_endpoint: "https://as.test/oauth/token" } as unknown as AuthorizationServerMetadata)
})
