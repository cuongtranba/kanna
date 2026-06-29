import { test, expect } from "bun:test"
import { startMcpOAuth } from "./mcp-oauth.adapter"
import type { McpServerConfig, McpOAuthState } from "../shared/types"

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

// Fake AS: 401 -> PRM -> openid-config -> register -> (authorize is browser).
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
    // Candidate 1 (path-aware oauth-authorization-server): not found — fall through to openid-config
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
    throw new Error("unexpected fetch: " + url)
  }) as unknown as typeof fetch
}

test("startMcpOAuth discovers AS, registers, and returns an authorization URL", async () => {
  const cfg = baseConfig()
  const persisted: McpOAuthState[] = []
  // Fix 6: typed persist param, no as never cast
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
  // Fix 7: strengthen crypto assertions
  expect(typeof last?.flow?.state).toBe("string")
  expect((last?.flow?.state ?? "").length).toBeGreaterThan(20)
  expect(typeof last?.flow?.codeVerifier).toBe("string")
  expect((last?.flow?.codeVerifier ?? "").length).toBeGreaterThan(20)
  expect(last?.issuer).toBe("https://as.test/v1/mcp")
})

// Fix 8: alreadyAuthenticated branch — never calls fetch
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
    persist: (_oauth: McpOAuthState) => { /* should not be called */ },
  })
  expect(result.kind).toBe("alreadyAuthenticated")
})

// Fix 9: first AS-metadata candidate returns 200 text/html (SPA trap), later
// candidate returns valid JSON — discovery still succeeds.
test("startMcpOAuth falls through SPA-HTML candidate to working openid-config", async () => {
  const spaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

    // Probe — 401 with www-authenticate header
    if (url === "https://example.test/v1/mcp" && init?.method === "POST") {
      return new Response("unauthorized", {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://example.test/v1/.well-known/oauth-protected-resource"',
        },
      })
    }
    // PRM
    if (url === "https://example.test/v1/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: ["https://as.test/"], scopes_supported: ["read"] })
    }
    // First candidate: /.well-known/oauth-authorization-server/ (path-aware) — SPA HTML trap
    if (url === "https://as.test/.well-known/oauth-authorization-server/") {
      return new Response("<html>SPA</html>", { status: 200, headers: { "content-type": "text/html" } })
    }
    // Second candidate: issuer /.well-known/openid-configuration — working JSON
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
    // Registration
    if (url === "https://as.test/oauth/register") {
      return json({ client_id: "spa-client", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error("unexpected fetch in spaFetch: " + url)
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

// Fix 10: probe 401 with NO www-authenticate header — adapter falls back to
// derived PRM URL and completes.
test("startMcpOAuth derives PRM URL from serverUrl when www-authenticate header is absent", async () => {
  const noHeaderFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

    // Probe — 401 with NO www-authenticate header
    if (url === "https://example.test/v1/mcp" && init?.method === "POST") {
      return new Response("unauthorized", { status: 401 })
    }
    // Derived PRM URL: ${origin}/.well-known/oauth-protected-resource${pathname}
    if (url === "https://example.test/.well-known/oauth-protected-resource/v1/mcp") {
      return json({ authorization_servers: ["https://as2.test/"], scopes_supported: ["openid"] })
    }
    // First candidate (path-aware): not found
    if (url === "https://as2.test/.well-known/oauth-authorization-server/") {
      return new Response("not found", { status: 404 })
    }
    // AS metadata via openid-configuration (root, no path)
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
    // Registration
    if (url === "https://as2.test/oauth/register") {
      return json({ client_id: "no-header-client", redirect_uris: ["http://localhost:8765/callback"] }, 201)
    }
    throw new Error("unexpected fetch in noHeaderFetch: " + url)
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
