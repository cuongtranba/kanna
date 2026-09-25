---
id: adr-20260925-mcp-oauth-offline-access-bearer-respawn
c3-seal: a7b015b2a6591d20e7a390e14137b2e200f99a2e49b2f247c5ff8b32f4ce90d2
title: mcp-oauth-offline-access-bearer-respawn
type: adr
goal: Keep an OAuth-authenticated custom MCP server working past a short access-token lifetime. Two defects combined so that Undercroft's `/mcp` (15-minute access tokens) was rejected fifteen minutes after every connect. The client never asked for `offline_access`, so no refresh token was issued. And a running claude process kept the bearer header it was spawned with, even after the stored token was refreshed. This ADR makes Kanna request `offline_access` whenever the authorization server advertises it, and treats a bearer past its usable window as a reason to respawn the session on the next turn.
status: proposed
date: "2026-09-25"
---

## Goal

Keep an OAuth-authenticated custom MCP server working past a short access-token lifetime. Two defects combined so that Undercroft's `/mcp` (15-minute access tokens) was rejected fifteen minutes after every connect. The client never asked for `offline_access`, so no refresh token was issued. And a running claude process kept the bearer header it was spawned with, even after the stored token was refreshed. This ADR makes Kanna request `offline_access` whenever the authorization server advertises it, and treats a bearer past its usable window as a reason to respawn the session on the next turn.

## Context

`resolveAuthServer` in `mcp-oauth.adapter.ts` took the requested scope only from the protected-resource metadata's `scopes_supported`. A PRM names the resource's own scopes; `offline_access` is an authorization-server scope listed in the AS metadata, and Undercroft's PRM correctly omits it (its `mcpSignIn.test.ts` pins the PRM to `undercroft:read undercroft:write`). Better Auth issues a refresh token only to a client that asked for `offline_access`, so the stored state held `expires_in: 900` and no `refresh_token`, and `ensureFreshMcpToken` threw `access token expired and no refresh token`. `buildOAuthBearers` logged and skipped the server. Separately, `spawnClaudeTurn` resolves bearers only when it spawns; the header rides the MCP config the CLI reads once, so a warm session reused after expiry sent the old token and got 401 until some unrelated trigger respawned it. Topology: c3-226 owns the OAuth adapter; c3-210 owns the spawn path, the session state, and the config helpers.

## Decision

Request `offline_access` when the AS metadata lists it, appended to the PRM scopes (`requestedScope`). Expose the adapter's single token-lifetime rule as `bearerUsableUntil` (expiry minus the 60 s refresh skew) and use it both for refresh and for the session. `buildOAuthBearers` returns `OAuthBearers` (the map plus the soonest `usableUntil`, read from the refreshed state when a refresh happened). `spawnClaudeTurn` stores it on `ClaudeSessionState.mcpBearersUsableUntil`, and `mcpBearersStale(now)` joins `contextClearPending` in the respawn condition. The respawn resumes the session, so context is kept. The predicate stands aside while `isHoldingWork(now)`, because with 15-minute tokens a respawn would otherwise kill background tasks and workflows every quarter hour. This wins over a CLI-side `headersHelper`, which is also resolved per connection and so would stay stale inside a session, and over an unconditional respawn, which would destroy live background work.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | requestedScope adds offline_access; bearerUsableUntil becomes the one token-lifetime rule | c3-226#n11818@v1:sha256:45261301f0a6af409208173fa9380d0a5c9d87a9ac356e8bd6bbf30c673b194b "Host the in-process loopback MCP server that the Claude driver attaches" | Review ref-strong-typing: the new exports are typed over McpOAuthState and AuthorizationServerMetadata |
| c3-210 | component | buildOAuthBearers returns OAuthBearers; spawnClaudeTurn records and checks mcpBearersUsableUntil | c3-210#n10980@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Review rule-colocated-bun-test: new cases live in the colocated spawner and helpers suites |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/mcp-oauth.test.ts src/server/claude-session-config-helpers.test.ts src/server/claude-session-spawner.test.ts src/server/claude-subagent-wiring.test.ts | 82 pass, 0 fail |
| bun run typecheck && bun run lint && bun run lint:comments && bun run check:arch | all clean |
| bun run test | only the 7 PaneTabStrip failures that also fail on untouched main in full-suite order |
