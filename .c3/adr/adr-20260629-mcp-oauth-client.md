---
id: adr-20260629-mcp-oauth-client
c3-seal: e96e96c600a9b0a623f58ec4a246b6b16cadd22e8ed77b649f99a42de3da0310
title: mcp-oauth-client
type: adr
goal: |-
    Add OAuth 2.1 (PKCE + DCR + rotating refresh tokens) support for user-configured
    HTTP and SSE custom MCP servers, so authenticated tools (e.g. Anthropic design MCP
    returning 20 tools behind OAuth) register in Kanna chats under both SDK and PTY
    drivers. Bearer tokens are resolved at spawn time and injected into transport headers;
    tokens refresh automatically on near-expiry.
status: proposed
date: "2026-06-29"
---

## Goal

Add OAuth 2.1 (PKCE + DCR + rotating refresh tokens) support for user-configured
HTTP and SSE custom MCP servers, so authenticated tools (e.g. Anthropic design MCP
returning 20 tools behind OAuth) register in Kanna chats under both SDK and PTY
drivers. Bearer tokens are resolved at spawn time and injected into transport headers;
tokens refresh automatically on near-expiry.

## Context

Custom MCP servers registered via Settings → MCP servers currently support only
static headers for authentication. Several production MCP servers (Anthropic design
MCP, etc.) require OAuth 2.1 protected access with short-lived tokens (8 h TTL).
Injecting the token as a static header is unworkable because tokens rotate. The
existing `mcp-validator.ts` connect-test has no bearer-inject path. Both drivers
(`buildUserMcpServers` for SDK, `buildMcpConfigJson` for PTY) build MCP configs
synchronously and cannot perform network I/O inline. The affected topology spans the
shared types (McpOAuthState), the server (app-settings, ws-router, agent, PTY driver,
validator), and the client settings UI (McpServersSection).

## Decision

Implement explicit discovery in a new `mcp-oauth.adapter.ts` (exempt from
side-effect seal by the `.adapter.ts` convention). Discovery probes the OpenID
path (`/.well-known/openid-configuration`) before RFC8414 to handle servers like
Anthropic design MCP that serve HTML at the RFC8414 path. The SDK granular helpers
(`registerClient`, `startAuthorization`, `exchangeAuthorization`,
`refreshAuthorization`) handle PKCE and token exchange. A two-step paste UX (no
redirect server) drives the callback via two new WS commands (`startMcpOAuth`,
`completeMcpOAuth`). At spawn, `AgentCoordinator.buildOAuthBearers` resolves a
`ReadonlyMap<serverId, accessToken>` (refresh if near-expiry) and passes it as a
pure parameter to both config builders — keeping them synchronous and side-effect-free
(side-effect seal preserved). Bearer is also injected into the `validateMcpServer`
connect-test via a new `bearer` option.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | New McpOAuthState, McpOAuthFlowState, extend McpServerNetworkFields + McpServerPatch + AppSettingsPatch | Review ref-strong-typing |
| c3-226 | component | New mcp-oauth.adapter.ts + mcp-validator.ts bearer option collocated in server/ | Review ref-local-first-data |
| c3-208 | component | Two new WS commands startMcpOAuth + completeMcpOAuth added to protocol.ts and router | Review ref-ws-subscription |
| c3-210 | component | buildOAuthBearers added; spawn path calls adapter before building MCP config | Review rule-strong-typing |
| c3-116 | component | McpServersSection gains OAuth toggle + Authenticate/Complete UI; useKannaState gains two handlers | Review rule-colocated-bun-test |
| c3-225 | component | buildMcpConfigJson gains oauthBearers param; StartClaudeSessionPtyArgs gains oauthBearers | Review rule-strong-typing |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-ws-subscription | New startMcpOAuth/completeMcpOAuth commands use the WS command envelope | comply |
| ref-local-first-data | OAuth tokens persist in settings.json (0600) — local storage, no external secret store | comply |
| ref-strong-typing | McpOAuthState, OAuthStartResult, ReadonlyMap types introduced; no any | comply |
| ref-colocated-bun-test | mcp-oauth.test.ts + mcp-validator.test.ts + ws-router tests co-located | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | New adapter and modified modules each have co-located .test.ts | comply |
| rule-strong-typing | All new types explicit; no any or unknown used unnarrowed | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/types.ts | McpOAuthState, McpOAuthFlowState, extend McpServerNetworkFields, McpServerPatch, AppSettingsPatch | Committed in feat(mcp-oauth): types |
| src/server/mcp-oauth.adapter.ts (NEW) | Discovery + start/complete/refresh OAuth flow | Committed in feat(mcp-oauth): adapter |
| src/server/app-settings.ts | setOAuthState patch op, validateMcpShape oauth rules | Committed in feat(mcp-oauth): types |
| src/server/mcp-validator.ts | bearer option + networkHeaders helper | Committed in feat(mcp-oauth): bearer injection |
| src/server/kanna-mcp-http.ts + agent.ts + claude-pty/driver.ts | oauthBearers param plumbing to both config builders | Committed in feat(mcp-oauth): bearer injection into both drivers |
| src/server/ws-router.ts + src/shared/protocol.ts | startMcpOAuth + completeMcpOAuth WS commands | Committed in feat(mcp-oauth): ws commands |
| src/client/app/McpServersSection.tsx + useKannaState.ts | OAuth toggle + Authenticate/Complete UI, KannaState handlers | Committed in feat(mcp-oauth): settings UI |
| CLAUDE.md | OAuth subsection under Custom MCP Servers | Added in Task 10 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| ADR | This ADR created for the MCP OAuth feature | c3x check passes after add |
| Component codemap | mcp-oauth.adapter.ts ownership added to c3-226 | c3x lookup src/server/mcp-oauth.adapter.ts matches c3-226 |
| Component codemap | McpServersSection.tsx ownership added to c3-116 | c3x lookup src/client/app/McpServersSection.tsx matches c3-116 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test --conditions production | All 235 modified-file tests pass; mcp-oauth.test.ts covers adapter flows | bun test passes |
| bun run lint | ESLint 0 warnings; side-effect seal: fetch only in .adapter.ts | bun run lint passes |
| bun tsc --noEmit | No TypeScript errors across changed files | tsc exits 0 |
| CLAUDE.md OAuth section | Documents explicit discovery, two-step paste, bearer injection, token storage | Added under Custom MCP Servers section |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| SDK auto-discovery (auth.js discovery()) | RFC8414 path returns claude.ai SPA HTML for Anthropic design MCP; OpenID path required — SDK provides no explicit path override |
| Redirect server on localhost:3334 | Requires binding a port Kanna does not own; conflicts if another process uses it; out of scope for this PR |
| Storing tokens in separate secret store | settings.json (0600) is the project's established local secret store for API keys; adding another store increases complexity with no benefit for a single-user local app |
| Inline token refresh at spawn (sync) | Network I/O at spawn violates side-effect seal for buildUserMcpServers/buildMcpConfigJson; pre-resolved bearer map keeps builders pure |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Token leaked in logs | tokens/access_token only written to settings.json (0600); console.warn on refresh failure uses only server name | Code review: grep for token logging |
| settings.json grows unbounded with clientByIssuer | clientByIssuer keyed by issuer (typically 1 per server); pruned only on server delete | Acceptable for typical user cardinality (<10 MCP servers) |
| OAuth-enabled server blocks spawn on network failure | buildOAuthBearers catches per-server errors with console.warn; spawn continues with no bearer for that server | Unit test covers failed refresh path |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/mcp-oauth.test.ts src/server/mcp-validator.test.ts src/server/ws-router.test.ts src/server/kanna-mcp-http.test.ts src/server/agent.test.ts src/client/app/McpServersSection.test.tsx | 235 pass, 0 fail |
| bun run lint | 0 warnings |
| bun tsc --noEmit | 0 errors |
