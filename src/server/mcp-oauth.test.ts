import { test, expect } from "bun:test"
import { startMcpOAuth } from "./mcp-oauth.adapter"
import type { McpServerConfig } from "../shared/types"

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
  const persisted: Record<string, unknown>[] = []
  const result = await startMcpOAuth(cfg, {
    fetchFn: fakeFetch(),
    persist: (oauth) => persisted.push(oauth as never),
  })
  expect(result.kind).toBe("authorizationUrl")
  if (result.kind !== "authorizationUrl") throw new Error("unreachable")
  const u = new URL(result.authorizationUrl)
  expect(u.origin + u.pathname).toBe("https://as.test/oauth/authorize")
  expect(u.searchParams.get("client_id")).toBe("client-123")
  expect(u.searchParams.get("code_challenge_method")).toBe("S256")
  expect(u.searchParams.get("resource")).toBe("https://example.test/v1/mcp")
  const last = persisted.at(-1) as { flow?: { state?: string; codeVerifier?: string }; issuer?: string }
  expect(last.flow?.state).toBeTruthy()
  expect(last.flow?.codeVerifier).toBeTruthy()
  expect(last.issuer).toBe("https://as.test/v1/mcp")
})
