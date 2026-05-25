---
id: adr-20260525-share-decouple-tunnel
c3-seal: e5943b725b825fd8c0a846b5e856d553c4f70a516cb4743cc90b89f3361e871a
title: share-decouple-tunnel
type: adr
goal: 'Decouple `c3-228 session-share` mint from the per-chat Cloudflare tunnel state (`c3-218 share`). Share URLs are derived from the origin of the authenticated WebSocket upgrade request (`req.headers.host` + protocol). Mint refuses no requests for missing tunnel; the `NO_TUNNEL` error path is removed. Public reachability of the resulting URL is a deployment concern, not a runtime gate. Outcome: owners can mint a share URL from any reachable Kanna instance — laptop with tunnel, laptop on localhost, VPS, anything — and the URL points back at whatever origin they used to reach the server.'
status: implemented
date: "2026-05-25"
---

## Goal

Decouple `c3-228 session-share` mint from the per-chat Cloudflare tunnel state. Share URLs are derived from the origin of the WebSocket upgrade request. Mint never refuses for missing tunnel; the `NO_TUNNEL` error path is removed. Public reachability of the resulting URL is a deployment concern.

## Context

`c3-228 session-share` (adr-20260524-session-share) required an active Cloudflare tunnel for `c3-218 share` before mint would succeed: the service called `getTunnelBaseUrl()`, and when it returned `null` the mint returned `{ kind: "no_tunnel" }`. The `ShareButton` UI was gated on `tunnelUp` and rendered disabled with a "Start a Cloudflare tunnel to enable public sharing" tooltip when no tunnel record existed.

This produced two problems:

1. Users hitting Kanna over their own configured hostname (e.g. `https://kanna.lowbit.link` already wired via a separate always-on cloudflared) saw the button disabled because no _per-chat_ tunnel record existed in the snapshot — even though their instance was already publicly reachable.
2. Dev/local users who genuinely could not be reached publicly had no way to mint a URL for testing or for in-network sharing.

Tunnel state is a deployment property: whoever runs the server already chose whether to expose it. The mint layer should not second-guess that choice. The simplest model is "build the URL from whatever origin the owner used to reach the server" — same hostname they're already typing into their browser, same scheme.

## Decision

Remove the tunnel-base coupling from `c3-228 session-share`:

1. `SessionShareDeps.getTunnelBaseUrl` is removed. `mintToken` and `listSharesForChat` accept a `baseUrl: string` argument supplied by the caller.
2. `ShareError.kind === "no_tunnel"` is removed from the shared error union. The `no_tunnel` branch in `mintToken` is deleted.
3. The WS router captures the request origin (scheme + host) at WebSocket upgrade time and stores it in `ClientState.originHost`. Mint and list calls pass `ws.data.originHost` as `baseUrl`. URLs are formed as `${originHost}/share/<token>`.
4. Client-side: `ShareButton` and `SharePopover` drop the `tunnelUp` prop. The button is always enabled when a chat is selected. The "tunnel down" tooltip and disabled-state path are removed.
5. `ChatPage` drops the `shareTunnelUp` derivation from the chat snapshot.

Public reachability is a deployment concern — solved by the operator running cloudflared, exposing a port, deploying to a VPS, or any other means. The mint layer does not enforce it.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-228 | component | Mint contract change: drop `getTunnelBaseUrl` dep, drop `no_tunnel` failure mode, accept `baseUrl` per call. Foundational-flow `Precondition` row drops the tunnel requirement. Business-flow `Alternate — NO_TUNNEL` row is removed. | ref-strong-typing |
| c3-208 | component | `ws-router` `share.mint` / `share.list` handlers pass `ws.data.originHost` into the service. `ClientState` gains `originHost?: string`. Upgrade handler captures the request origin. | ref-ws-subscription, ref-strong-typing |
| c3-202 | component | HTTP server `serverInstance.upgrade` `data` payload gains `originHost` derived from `req.headers.host` + protocol. | ref-strong-typing |
| c3-115 | component | `ShareButton` and `SharePopover` drop `tunnelUp` prop; `ChatNavbar` drops `shareTunnelUp` plumbing; `ChatPage` drops `liveTunnelRecord` derivation for share. | ref-zustand-store (N.A) |
| c3-306 | component | `ShareError` discriminated union loses the `no_tunnel` variant. | ref-strong-typing |
| c3-218 | component | No longer referenced by c3-228. `c3-218 share` (cloudflared tunnel) remains for its own purpose — public exposure of the host — but is no longer a precondition for mint. | N.A — only reference removed |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | `ShareError` union narrows; `MintRequest` / `listSharesForChat` signatures change; `ClientState.originHost` added — all must be concretely typed, no `any` | comply |
| ref-ws-subscription | Mint and list still flow through the typed WebSocket; only the payload threading changes | comply |
| ref-colocated-bun-test | Existing `session-share.test.ts` and `share-projection.test.ts` updated in place alongside their subjects | comply |
| ref-local-first-data | Snapshot persistence unchanged — still `~/.kanna/shares/<token>.json` (mode 0600); only URL formation changes | comply |
| ref-event-sourcing | No event schema change; `share.token_minted` and `share.token_revoked` payloads untouched | comply |
| ref-cqrs-read-models | Share projection unchanged | comply |
| ref-side-effect-adapter | No new fs / network calls; reads `req.headers.host` at upgrade time, which is already part of the HTTP boundary in `c3-202` | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Union narrowing and new `originHost` field must be precisely typed | comply |
| rule-colocated-bun-test | Updated tests sit next to their subjects | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared types | Remove `no_tunnel` variant from `ShareError` in `src/shared/session-share/types.ts` | src/shared/session-share/types.ts |
| SessionShareService | Drop `getTunnelBaseUrl` from `SessionShareDeps`; remove `no_tunnel` branch in `mintToken`; accept `baseUrl: string` in `mintToken` and `listSharesForChat` | src/server/session-share/index.ts |
| Server bootstrap | Stop passing `getTunnelBaseUrl` into `SessionShareService` deps | src/server/server.ts |
| WS upgrade | Capture request origin into `ClientState.originHost` at upgrade time | src/server/server.ts, src/server/ws-router.ts |
| WS router | Pass `ws.data.originHost ?? ""` to `mintToken` and `listSharesForChat` | src/server/ws-router.ts |
| Client UI | Remove `tunnelUp` prop from `ShareButton`, `SharePopover`; always-enabled state; drop tunnel-down tooltip path | src/client/components/share/ShareButton.tsx, src/client/components/share/SharePopover.tsx |
| ChatNavbar | Drop `shareTunnelUp` prop + plumbing | src/client/components/chat-ui/ChatNavbar.tsx |
| ChatPage | Drop `liveTunnelRecord` / `shareTunnelUp` derivation | src/client/app/ChatPage/index.tsx |
| Tests | Update `session-share.test.ts` to use `baseUrl` arg; remove `no_tunnel` assertions; update `ShareButton.test.tsx` / `SharePopover.test.tsx` to drop `tunnelUp` | colocated `*.test.ts(x)` |
| C3 doc | Update `c3-228-session-share.md`: drop `Precondition` tunnel row, drop `Alternate — NO_TUNNEL` row, drop the dependency on `c3-218` from the description | .c3/c3-2-server/c3-228-session-share.md |
| Wiki | Update `wiki/src/content/docs/sharing/session-share.mdx` to remove tunnel-required language | wiki/src/content/docs/sharing/session-share.mdx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-228 component | Edit `c3-2-server/c3-228-session-share.md` Foundational Flow + Business Flow + Change Safety to drop tunnel precondition and `NO_TUNNEL` rows | c3x check reports clean |
| ADR | This ADR — adr-20260525-share-decouple-tunnel — added; status `implemented` after code merged | c3x check --include-adr reports clean |
| Refs wired | No ref additions/removals on c3-228; existing 5 refs unchanged | c3x check reports clean |
| N.A - schema/validator | No c3x schema or validator changes required by this ADR | N.A - no underlay schema modified |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run lint | ESLint catches any leftover `tunnelUp` / `getTunnelBaseUrl` / `no_tunnel` references | bun run lint output |
| bun run build | tsc rejects any remaining `no_tunnel` matcher / missing `originHost` field | bun run build output |
| bun test src/server/session-share/ | All existing tests pass after signature update | bun test output |
| bun test src/client/components/share/ | ShareButton + SharePopover render + interaction tests pass without `tunnelUp` | bun test output |
| c3x check --include-adr | Validates updated c3-228 and new ADR remain consistent | c3x check output |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| `KANNA_PUBLIC_BASE_URL` env var | Adds deployment config surface; "make it simple" — owner's current origin is already the right answer 99% of the time |
| Keep `getTunnelBaseUrl` but fall back to request host when null | Two URL-source code paths; harder to reason about; doesn't solve the "tunnel record absent but instance is reachable" case described in Context |
| Keep `tunnelUp` gate, just fix the snapshot derivation | Treats symptom, not cause; mint layer should not own deployment-reachability concerns |
| Server-side warn when URL looks local | Out of scope for this ADR; can be added later as a banner without revisiting the mint contract |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Mint succeeds, URL not reachable from recipient | Out of scope by design — deployment concern. Owners running on bare localhost get a `http://localhost:3210/share/<token>` URL they can paste in-network or self-test | Wiki updated to document the new "URL = your current origin" contract |
| Empty `originHost` (e.g. unit test wiring forgets to set it) | URL falls back to `/share/<token>` (relative). Existing test covers the empty case to keep behaviour explicit | session-share.test.ts |
| `Host` header spoofing rewrites the URL to attacker-chosen domain | Threat exists upstream of c3-228 (any reverse-proxy hop already trusts `Host`). Owner is the only consumer of the minted URL — they can copy/paste verify before sending | N.A — accepted risk |
| Scheme guessed wrong (http vs https) behind a TLS-terminating tunnel | Use the request URL's protocol when available; default to `https` when running behind a proxy header `x-forwarded-proto: https` | session-share.test.ts |

## Verification

| Check | Result |
| --- | --- |
| c3x check --include-adr | Clean — no errors |
| bun run lint | Zero warnings/errors |
| bun run build | tsc clean |
| bun test src/server/session-share/ | All assertions pass |
| bun test src/client/components/share/ | All assertions pass |
| Manual: open `http://localhost:5174/`, click Share on any chat | Mint succeeds; popover shows `http://localhost:5174/share/<token>` URL |
| Manual: open `https://kanna.lowbit.link/`, click Share on any chat | Mint succeeds; popover shows `https://kanna.lowbit.link/share/<token>` URL |
