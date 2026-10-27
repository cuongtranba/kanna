import { describe, expect, test } from "vite-plus/test"
import { isRemoteMcpOAuthPath, rewriteBareDiscoveryPath } from "./oauth-paths"

describe("remote MCP OAuth path allowlist", () => {
  test("accepts the protocol endpoints and discovery documents", () => {
    for (const pathname of [
      "/api/auth/oauth2/authorize",
      "/api/auth/oauth2/token",
      "/api/auth/oauth2/register",
      "/api/auth/oauth2/revoke",
      "/api/auth/jwks",
      "/api/auth/.well-known/openid-configuration",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/api/auth",
    ]) {
      expect(isRemoteMcpOAuthPath(pathname), pathname).toBe(true)
    }
  })

  test("rejects sign-up, session, consent and unrelated paths", () => {
    for (const pathname of [
      "/api/auth/sign-up/email",
      "/api/auth/sign-in/email",
      "/api/auth/get-session",
      "/api/auth/oauth2/consent",
      "/api/auth/oauth2/introspect",
      "/api/auth/oauth2/public-client",
      "/api/auth/oauth2/authorize/extra",
      "/.well-known/oauth-protected-resource/other",
      "/.well-known/other",
      "/mcp",
      "/",
    ]) {
      expect(isRemoteMcpOAuthPath(pathname), pathname).toBe(false)
    }
  })

  test("bare authorization-server discovery paths are rewritten to the provider's path-aware form", () => {
    expect(rewriteBareDiscoveryPath("/.well-known/oauth-authorization-server"))
      .toBe("/.well-known/oauth-authorization-server/api/auth")
    expect(rewriteBareDiscoveryPath("/.well-known/openid-configuration"))
      .toBe("/api/auth/.well-known/openid-configuration")
    expect(rewriteBareDiscoveryPath("/api/auth/jwks")).toBe("/api/auth/jwks")
  })
})
