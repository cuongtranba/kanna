---
id: adr-20261011-remote-mcp-server
c3-seal: ee74fc30d2ed70e70838be72353d2371aa8303c0291c4e5bfd25d03114443204
title: remote-mcp-server
type: adr
goal: Let external MCP clients (Claude Code, Codex, Claude Desktop and claude.ai, ChatGPT) drive a running Kanna server over a remote MCP endpoint at /mcp, using Better Auth as the OAuth 2.1 authorization server and the existing launch password as an alternative bearer, with every tool running through the same ws-router handlers the browser uses.
status: done
date: "2026-10-11"
---

## Goal

Let external MCP clients (Claude Code, Codex, Claude Desktop and claude.ai, ChatGPT) drive a running Kanna server over a remote MCP endpoint at /mcp, using Better Auth as the OAuth 2.1 authorization server and the existing launch password as an alternative bearer, with every tool running through the same ws-router handlers the browser uses.

## Context

The user asked for a remote MCP server so agents outside the browser can run Kanna: list projects, send prompts, answer tool requests, move board cards, change settings. The clients differ in how they authenticate: Claude Code and Claude Desktop can send a static Authorization header or run OAuth, ChatGPT supports OAuth only, and Codex reads a bearer token from an environment variable or runs OAuth. Kanna already had Better Auth (#1247) behind a hidden owner user whose credential is the launch password, with a database-backed sign-in limiter of 3 attempts per 10 seconds per address. The server had no MCP endpoint, no OAuth provider, no way to run a ClientCommand without a WebSocket, and trusted x-kanna-client-ip as the address Better Auth rate-limits on.

## Decision

Better Auth's @better-auth/mcp plugin plus the core jwt() plugin make the existing instance the authorization server, so token issuance, dynamic client registration, PKCE and key rotation are not hand-written. baseURL becomes the public origin (remoteMcp.publicUrl, else http://127.0.0.1:<bound port>) and the instance is rebuilt when it changes, because mcp() validates the resource when it is constructed and accepts only https or loopback http. Kanna mounts Better Auth through an allowlist (handleOAuth) rather than the whole handler, strips any client-supplied x-kanna-client-ip and sets it from the socket, and renders its own login and consent pages. The launch password is accepted as a bearer by signing in once through Better Auth and caching the session cookie by sha256, so the hash check and the limiter stay the only verifier and a wrong password still reaches 429. Tools run through router.dispatchCommand and router.readSnapshot, a seam added to the ws-router, so WebSocket clients see the same broadcasts. The endpoint is stateful Streamable HTTP with a bounded session registry. Without --password every owned path answers 404, and remoteMcp.enabled turns the surface off with the same 404.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-242 | component | New component that owns the /mcp endpoint, sessions, bearer verifier, tools, resources and settings | c3-242#n14272@v1:sha256:789ec00a492e7b5b12214e71cb693251b142470000a67ab232cd2f7f8567f88a "Serve Kanna to external MCP clients (Claude Code, Codex, Claude Desktop, ChatGPT) over an authenticated Streamable HTTP endpoint at /mcp, with Better Auth actin" | Typed against the ClientCommand union; no casts |
| c3-124 | component | New component for the Remote MCP settings page and setup snippets | c3-124#n14392@v1:sha256:e80bacf08cfc0a1a4222f08daace8ccd3e4b9d44b33ebb22b23b79555f0f9fc4 "Show the Remote MCP settings page where the owner turns the server on or off, sets its public URL and copies per-client setup snippets." | State lives in a Zustand store; no useState |
| c3-203 | component | Better Auth becomes an OAuth provider, and the AuthBackend port gains handleOAuth, verifyRemoteMcpToken, consentForOAuth and describeOAuthClient | c3-203#n11159@v1:sha256:ccb9a5ad2060ab5bc222b4e75ed5e3a152fed11be61ff27c37be0bae3f390667 | Forged client IP must not reach the limiter |
| c3-202 | component | The dispatcher serves /mcp, /oauth/* and the well-known paths before the cookie gate | c3-202#n11137@v1:sha256:dd5b274bf77e5ac772e1290ec609f9637a3e70bf4398892b993eca4a575b4baf | Route order is part of the security contract |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/remote-mcp/remote-mcp-http-routes.test.ts | Drives a real server with the real MCP SDK client: password bearer, OAuth round trip through login and consent with a JWT, 401 challenge, 404 without a password or when disabled, 429 on repeated wrong passwords, and a forged client IP header that cannot evade the registration limit | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| src/server/remote-mcp/remote-mcp-oauth.test.ts | Proves the discovery documents, dynamic registration, PKCE authorize, token and refresh, audience binding and the bearer verifier against a real Better Auth instance | bun run test src/server/remote-mcp/remote-mcp-oauth.test.ts |
| src/server/remote-mcp/oauth-paths.test.ts | Rejects every path outside the allowlist | bun run test src/server/remote-mcp/oauth-paths.test.ts |
| src/server/remote-mcp/command-catalog.test.ts | Fails when a ClientCommand has no catalog entry or the catalog names a command that does not exist | bun run test src/server/remote-mcp/command-catalog.test.ts |
| src/server/remote-mcp/remote-mcp-tools.test.ts | Lists the exact tool names and exercises the typed tools against the store and the failing-turn agent | bun run test src/server/remote-mcp/remote-mcp-tools.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand-rolled OAuth server | Dynamic client registration, PKCE, refresh rotation and JWKS are the code most likely to be wrong, and Better Auth already owns the user and session tables |
| Mounting the whole Better Auth handler | It would expose sign-up, session and user routes and the unauthenticated surface would grow with every Better Auth release |
| A second rate limiter for the bearer path | Two limiters disagree about the same password, and the database limiter already survives restarts |
| Per-tool direct store access | Mutations would skip the ws-router handlers and their broadcasts, so open browsers would not update |
| Stateless Streamable HTTP | Server-initiated notifications and the standalone SSE stream need a session, and clients such as Claude Code expect one |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A client forges x-kanna-client-ip to rotate past the rate limit | The route deletes the header and sets it from the socket address through clientIpFor | The forged-header test in remote-mcp-http-routes.test.ts fails when the strip is removed |
| The allowlist is widened by accident | The allowlist is one pure function with a rejecting test | bun run test src/server/remote-mcp/oauth-paths.test.ts |
| Sessions accumulate | Idle sessions close after 60 minutes and the registry holds at most 64 | bun run test src/server/remote-mcp/remote-mcp-session-registry.test.ts |
| A non-loopback http publicUrl breaks mcp() | The setting normalizer drops it and configureRemoteMcp keeps the previous instance | bun run test src/shared/settings/remote-mcp.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/remote-mcp | oauth, bearer, routes, session, tools, send-and-wait, redaction and catalog suites pass |
| bun run test src/client/components/settings/RemoteMcpSection.test.tsx | the settings page renders its notice, switch, endpoint and snippets without a render loop |
| bun run check | typecheck, lint, comment gate, client build and bundle check pass with better-auth absent from dist/client |
