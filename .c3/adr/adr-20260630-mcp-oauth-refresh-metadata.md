---
id: adr-20260630-mcp-oauth-refresh-metadata
c3-seal: b9fcf67d6b0bb6ff33ddcb60bad23cee2ce02f4fac6bf0ee6e73ffff75173ed0
title: mcp-oauth-refresh-metadata
type: adr
goal: |-
    Fix MCP OAuth token refresh so an authenticated http/sse custom MCP server (e.g.
    Anthropic design MCP) keeps working past the access-token TTL (8 h) instead of
    failing with "token refresh failed" and forcing a manual re-authenticate every
    8 hours. Persist the authorization-server metadata (token_endpoint) at
    complete-time and use it at refresh-time so the SDK does not re-discover from the
    stored issuer.
status: implemented
date: "2026-06-30"
---

## Goal

Fix MCP OAuth token refresh so an authenticated http/sse custom MCP server (e.g.
Anthropic design MCP) keeps working past the access-token TTL (8 h) instead of
failing with "token refresh failed" and forcing a manual re-authenticate every
8 hours. Persist the authorization-server metadata (token_endpoint) at
complete-time and use it at refresh-time so the SDK does not re-discover from the
stored issuer.

## Context

`completeMcpOAuth` resolves AS metadata during `startMcpOAuth` (stored only on the
transient `flow.metadata`), uses it for the code exchange, then clears `flow`
without persisting the metadata into `McpOAuthState`. At refresh time
`ensureFreshMcpToken` has no metadata, so `refreshAuthorization(issuer, { metadata:
undefined })` falls back to discovering `token_endpoint` from the stored `issuer`.
For Anthropic design MCP the PRM `authorization_servers[0]` is
`https://claude.ai/v1/design/mcp` — a path the SDK cannot resolve to AS metadata
(returns SPA HTML), so refresh 401s and the state flips to `error`. Observed in
session e4ff072e: `oauth.status:"error"`, `errorMessage:"token refresh failed"`,
connect-test `unauthorized`. The access-token exchange worked (metadata was
in-memory), only refresh is broken. Affected topology: c3-226 (adapter),
c3-301 (McpOAuthState type).

## Decision

Add an optional `metadata?: Record<string, unknown>` field to `McpOAuthState`.
`completeMcpOAuth` persists `flow.metadata` into it on success. `ensureFreshMcpToken`
sources AS metadata as `deps.metadataByIssuer?.[issuer] ?? oauth.metadata` and passes
it to `refreshAuthorization`, so the SDK uses the cached `token_endpoint` directly and
never re-discovers from the (possibly non-resolvable) issuer. No issuer-shape change
needed: when metadata is supplied the SDK ignores issuer discovery. The successful
refresh branch already spreads `...oauth`, preserving `metadata` across refreshes.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | McpOAuthState gains optional metadata field | Review ref-strong-typing |
| c3-226 | component | completeMcpOAuth persists metadata; ensureFreshMcpToken falls back to oauth.metadata | Review ref-local-first-data |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New McpOAuthState field is a named shared type, no any | comply |
| ref-local-first-data | metadata persists in settings.json (0600) alongside tokens | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | metadata typed as Record<string, unknown>; refresh metadata cast localized | comply |
| rule-colocated-bun-test | New refresh-with-persisted-metadata test in mcp-oauth.test.ts | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/types.ts | Add metadata?: Record<string, unknown> to McpOAuthState | edit |
| src/server/mcp-oauth.adapter.ts | completeMcpOAuth authenticatedState includes metadata: flow.metadata; ensureFreshMcpToken uses metadataByIssuer?.[issuer] ?? oauth.metadata | edit |
| src/server/mcp-oauth.test.ts | Test: refresh succeeds using persisted oauth.metadata with no metadataByIssuer | new test |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| ADR | This ADR created | c3x check passes |
| No codemap change | adapter + types already mapped (c3-226, c3-301) | c3x lookup unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test --conditions production src/server/mcp-oauth.test.ts | Refresh path test fails before fix, passes after | test run |
| bun run lint | 0 warnings; metadata cast confined to adapter | lint run |
| bun tsc --noEmit | 0 errors | tsc run |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Rewrite stored issuer to AS origin | Brittle: the correct token_endpoint is not always origin+/token; cached metadata is the authoritative source the SDK already accepts |
| Re-discover metadata at every refresh | Extra network round-trips + re-hits the SPA-HTML discovery bug that broke this in the first place |
| Pass metadataByIssuer from buildOAuthBearers only | Requires the caller to reconstruct the map every spawn; persisting on the state is simpler and survives restart |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Old authenticated entries lack persisted metadata | They re-auth once (current behavior); after re-auth metadata is stored and refresh works | Manual re-auth of claude-design then confirm survives past 8 h |
| Stale metadata if AS rotates token_endpoint | Rare; on refresh failure state flips to error → user re-auths, refreshing metadata | error-state UI pill prompts re-auth |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/mcp-oauth.test.ts | all pass incl. new refresh test |
| bun run lint | 0 warnings |
| bun tsc --noEmit | 0 errors |
