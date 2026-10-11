---
target: c3-203
scope: insert
base: c3-203#n11185@v1:sha256:54f6ab58351f02ae3e9972ea60506f953398abde62c2c595c9a99564c92fece4
---
| handleOAuth allowlist | OUT | AuthBackend.handleOAuth forwards a request to Better Auth only when isRemoteMcpOAuthPath accepts the path (authorize, token, register, revoke, jwks, the well-known documents); everything else returns null, and the bare discovery paths are rewritten to the path-aware form the provider serves | c3-242 | src/server/better-auth-oauth.adapter.ts |
| verifyRemoteMcpToken | OUT | Verifies a bearer JWT against the in-process JWKS with issuer public-origin/api/auth and audience public-origin/mcp; any failure is null and it is null until configureRemoteMcp has run | c3-242 | src/server/better-auth-oauth.adapter.ts |
| signInWithPassword and clientIpFor | OUT | AuthManager.signInWithPassword performs the owner sign-in used for the password bearer; clientIpFor applies the loopback and trustProxy rules to a socket address so callers can set x-kanna-client-ip from it | c3-242 | src/server/auth.ts |
