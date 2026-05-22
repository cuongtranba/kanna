---
id: adr-20260522-oauth-token-share-cap
c3-seal: b7607344a6b49cdb2bf6e7023304bbc1730229fae3e0f5eb95e9eaf08d6f8ac4
title: oauth-token-share-cap
type: adr
goal: Relax c3-224 oauth-token-pool's single-owner invariant ("prevent two chats from sharing one token") to a configurable per-token concurrency cap. Each `OAuthTokenEntry` carries a `maxConcurrent` field (1 = current behavior, default; user-raisable to N in the settings UI), and AppSettings carries a global `oauthTokenConcurrencyDefault` that supplies the field's default when a token entry omits it. The pool's reservation index becomes refcounted (`Map<tokenId, Set<chatId>>`). Rotation, refusal UI, and the PTY smoke-test path get hardened against the new failure modes that sharing introduces (rotation herd, smoke-probe thrash, 401 cascade). This authorizes the OAuth-pool component to operate in cap-bounded shared-ownership mode instead of mutually-exclusive ownership.
status: accepted
date: "2026-05-22"
---

## Goal

Relax c3-224 oauth-token-pool's single-owner invariant ("prevent two chats from sharing one token") to a configurable per-token concurrency cap. Each `OAuthTokenEntry` carries a `maxConcurrent` field (1 = current behavior, default; user-raisable to N in the settings UI), and AppSettings carries a global `oauthTokenConcurrencyDefault` that supplies the field's default when a token entry omits it. The pool's reservation index becomes refcounted (`Map<tokenId, Set<chatId>>`). Rotation, refusal UI, and the PTY smoke-test path get hardened against the new failure modes that sharing introduces (rotation herd, smoke-probe thrash, 401 cascade). This authorizes the OAuth-pool component to operate in cap-bounded shared-ownership mode instead of mutually-exclusive ownership.

## Context

Today c3-224 enforces 1 token = 1 chat via `reservedBy: Map<tokenId, chatId>` in `src/server/oauth-pool/oauth-token-pool.ts:28`. When all tokens are reserved, spawn refuses with `OAuthPoolUnavailableError` (`src/server/agent.ts:2152`) and the chat sees an "in use by [chat X]" message. Power users with one Pro/Max OAuth and several concurrent chats either get blocked or must buy more subscriptions. Subagent runs against the parent chat's only token are starved by the same gate. The user-visible cost outweighs the rate-limit isolation gain for many real workflows.

Affected topology: c3-224 (oauth-token-pool) owns the reservation index and refusal classification; c3-210 (claude-driver / agent rotation in `src/server/agent.ts`) holds rotation logic; c3-213 (quick-response / ephemeral pickers) uses `pickEphemeral` and must remain compatible; the PTY driver in `src/server/claude-pty/` adds new sharing-specific risks (cold-boot herd, smoke-probe race, 401 detector multiplication). The OAuth token storage lives under app-settings `claudeAuth.tokens` (c3-204 / c3-206 boundary) per ref-local-first-data; tokens never leave that surface.

Constraints: must preserve ref-local-first-data (no token egress); must preserve ref-strong-typing / rule-strong-typing (typed contract surfaces — no `any` at the pool API or at the agent boundary); must keep rule-colocated-bun-test (tests stay next to code); must keep the persisted-state invariant from c3-224 ("Reservation pinned across restart" → reservedBy stays in-memory only — the new Set-based map is still in-memory only).

## Decision

Switch the in-memory reservation index from `Map<tokenId, chatId>` to `Map<tokenId, Set<chatId>>`. `isEligible(token, now, reservedFor)` admits a token when the caller is already in the set OR `set.size < cap(token)`. `pickActive(reservedFor)` adds the caller to the picked token's set and removes the caller from any other token's set (a chat owns at most one token at a time across the pool, but a token can be owned by up to `cap(token)` chats). `release(reservedFor)` scans every set, removes the caller, and drops empty sets. `markLimited`/`markError`/`markDisabled` no longer silently drop reservations; they call a new `takeStaleOwners(id): string[]` helper that returns the set's owners and clears the set, so the agent layer can drive a coordinated re-pick instead of a herd.

`OAuthTokenEntry` gains an optional `maxConcurrent?: number` field. `OAuthTokenPool` resolves the cap at pick time via `tokenCap(token) = token.maxConcurrent ?? globalDefault ?? 1`. The global default is read from `AppSettings.oauthTokenConcurrencyDefault` via the existing `readTokens` closure shape — the pool grows a second closure `readGlobalCap(): number` injected at construction. Defaulting to 1 preserves current behavior on existing installs.

`describeUnavailability(reservedFor)` returns `byChatIds: string[]` (was `byChatId: string`) inside `reason: "reserved"`. `agent.ts:buildPoolUnavailableMessage` renders "in use by N chats" with one `/chat/<id>` link per current owner.

`agent.ts` adds a per-token rotation dedupe map (`Map<tokenId, { at: number; targetTokenId: string | null }>`, 5 s TTL). On `markLimited` / synthetic `oauth_invalid_token` for token T, the agent reads `takeStaleOwners(T.id)`, calls `pickActive(firstOwner)` once to pick the rotation target, caches that target for the window, and triggers respawn for each stale owner staggered by 250 ms.

PTY driver: `src/server/claude-pty/smoke-test.ts` adds an in-process singleflight (`Map<key, Promise<Result>>`, key = `${binarySha256}:${model}`) wrapping the live probe so concurrent shared-token spawns share one probe instead of racing two probes on the same OAuth.

Settings UI: each token row gains a number input (1–5) bound to `maxConcurrent`; the OAuth pool settings panel gains a global default input bound to `oauthTokenConcurrencyDefault` (1–5, fallback 1).

Why this wins for this repo: the in-memory map change is localized, refcounting via Set is the smallest semantically-correct replacement, the global+per-token default split lets the user opt in per-account without forcing a flag day, and the rotation/smoke hardening matches PTY's known cold-boot cost (`KANNA_PTY_TUI_BOOT_MS=3000`). It keeps every contract surface c3-224 lists in its Contract table (signatures change shape but every method retains its callsites).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-224 | component | Goal inverted from "prevent two chats from sharing one token" to "cap-bounded shared ownership". Contract for pickActive, describeUnavailability, markLimited/Error/Disabled changes shape. Change Safety row "Same token handed to two chats" deletes and is replaced by a "Cap exceeded by concurrent picks" row. | Rewrite Goal, Contract, Change Safety, Derived Materials |
| c3-210 | component | Rotation now drives staggered respawn for multiple owners of a limited/errored token; needs dedupe state and ordered respawn surface in Contract. | Add rotation-dedupe row to Contract; add herd-mitigation row to Change Safety |
| c3-213 | component | pickEphemeral still uses synthetic key; cap applies to ephemeral leases. No contract change but Change Safety must note ephemeral consumes one cap slot. | Append Change Safety row |
| c3-116 | component | settings-page renders the new per-token maxConcurrent input and the new global oauthTokenConcurrencyDefault input. Persisted via the existing settings store; new fields cross the client↔server boundary. | Update Contract row for OAuth pool settings panel |
| c3-2 | container | Server boot wires the new global-cap closure into OAuthTokenPool constructor. | No-delta if Responsibilities table still covers "boot wiring"; record Parent Delta evidence |
| c3-225 | component | claude-pty-driver gains smoke-test singleflight surface; its Contract must reference concurrent-safe canSpawn. | Append Contract row for smoke-test gate concurrency semantics |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | New settings field and per-token field still persist under ~/.kanna/data via app-settings; no token egress. | comply |
| ref-strong-typing | New maxConcurrent, oauthTokenConcurrencyDefault, and byChatIds: string[] payload must be typed at the shared boundary. | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Pool API (pickActive, describeUnavailability, takeStaleOwners), the AppSettings extension, and the AgentCoordinator rotation-dedupe map must use named types. No any, no untyped object literals. | comply |
| rule-colocated-bun-test | All new tests (oauth-token-pool.test.ts additions, smoke-test singleflight test, agent rotation herd test) sit beside the file under test. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add maxConcurrent?: number to OAuthTokenEntry; add oauthTokenConcurrencyDefault?: number to AppSettings. | src/shared/types.ts |
| oauth pool | Refactor reservedBy to Map<string, Set<string>>; add tokenCap, takeStaleOwners; update pickActive, release, mark{Limited,Error,Disabled}, describeUnavailability. Add readGlobalCap constructor closure. | src/server/oauth-pool/oauth-token-pool.ts |
| agent rotation | Add tokenRotationDedupe map in AgentCoordinator; consume takeStaleOwners on rotation; stagger respawn by 250 ms; update buildPoolUnavailableMessage for byChatIds. | src/server/agent.ts |
| pty smoke-test | Wrap canSpawn (or its underlying probe) in a per-(sha,model) singleflight cache. | src/server/claude-pty/smoke-test.ts |
| settings UI | Per-token number input + global default input in OAuth pool settings panel. | src/client/components/settings/<oauth pool panel> |
| tests | Update oauth-token-pool.test.ts, agent.oauth-pool.test.ts, agent.oauth-release.test.ts, agent.oauth-rotation.test.ts; new smoke-test.test.ts singleflight case; new PTY rotation-herd test. | src/server/, src/server/claude-pty/ |
| c3 docs | c3x write c3-224 (Goal + Contract + Change Safety + Derived Materials); c3x write c3-210 (rotation rows); c3x write c3-213 (ephemeral cap row); c3x write c3-204 c3-206 (settings shape); ADR Parent Delta evidence. | .c3/ via c3x CLI |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-224 body | Goal rewrite + Contract surfaces updated for cap-aware semantics + Change Safety row replacement + Derived Materials row for the new closure | c3x read c3-224 --full shows new Goal; c3x check --only c3-224 passes |
| c3-210 body | Append rotation-dedupe Contract row + Change Safety herd row | c3x read c3-210 --section Contract |
| c3-213 body | Append ephemeral cap Change Safety row | c3x read c3-213 --section "Change Safety" |
| ADR Parent Delta | This ADR records the goal inversion on c3-224 with goal: field rewritten | c3x set c3-224 goal "..." audited via c3x check |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| oauth-token-pool.test.ts | Cap=2 admit; cap=1 reject; refcount release; takeStaleOwners returns + clears | bun test src/server/oauth-pool/oauth-token-pool.test.ts |
| agent.oauth-rotation.test.ts | 3 owners on 1 token, force limit → 1 rotation target chosen, 3 staggered respawns, no double-pick on the new target | bun test src/server/agent.oauth-rotation.test.ts |
| agent.oauth-release.test.ts | Chat A release does not affect Chat B's reservation on the same token | bun test src/server/agent.oauth-release.test.ts |
| smoke-test.test.ts singleflight case | 5 concurrent canSpawn calls → 1 probe invocation | bun test src/server/claude-pty/smoke-test.test.ts |
| bun run lint | New types named; no any; warning cap respected | bun run lint |
| Settings UI | Number input rendered for maxConcurrent per token and global default; persisted via existing settings store | manual smoke + existing settings test if present |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Unconditional sharing (no cap) | Maximally amplifies Anthropic-side 429s and rotation herd; violates current change-safety posture without a knob to back off. |
| Per-token request serializer (queue turn-spawns per token, 1 concurrent stream) | Adds end-to-end turn latency every time chats overlap; complicates PTY (each PTY is long-lived, not request-shaped). Cap is the simpler first step; serializer can layer later if cap=N still produces 429s. |
| Global "share tokens" boolean flag | Coarser than per-token cap; cannot mix isolated and shared tokens in the same pool, which is the realistic mixed-account setup. |
| Env var KANNA_OAUTH_TOKEN_CAP_DEFAULT only | User wants a settings-page control. Env var would be invisible to non-CLI users and adds a config surface that fights the settings UI. Global default belongs in AppSettings. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Anthropic-side 429 / concurrent-session enforcement on shared OAuth | Default cap 1 preserves current behavior; per-token cap is user opt-in, fully reversible. | Manual: raise cap=2 on one token, run two chats, observe; rollback by lowering cap. |
| Rotation herd on markLimited / 401 with N shared owners | tokenRotationDedupe 5 s window + 250 ms staggered respawn; takeStaleOwners returns ordered owner list. | agent.oauth-rotation.test.ts herd case |
| Reservation leak when one of N owners crashes without closeClaudeSession | release(chatId) scans every set; existing closeClaudeSession + spawn-failure release paths already invoke it; new test covers refcount. | agent.oauth-release.test.ts refcount case |
| PTY smoke-probe double-fire on cold cache | Per-(sha,model) singleflight in smoke-test.ts. | smoke-test.test.ts singleflight case |
| describeUnavailability shape change breaks renderChatLinks UI parser | byChatIds: string[] rendered as N markdown links; chat-link regex unchanged; UI test updated. | ResultMessage.test.tsx covers multi-link case |
| Global default of 1 silently rolls forward; users do not discover the feature | Settings UI exposes the field with helper text; CHANGELOG entry on release. | Manual UI smoke + CHANGELOG diff |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/oauth-pool/ | All cases pass including cap-admit, cap-reject, refcount release, takeStaleOwners. |
| bun test src/server/agent.oauth-rotation.test.ts src/server/agent.oauth-pool.test.ts src/server/agent.oauth-release.test.ts | Rotation herd dedupe + staggered respawn; refcount release. |
| bun test src/server/claude-pty/smoke-test.test.ts | Singleflight collapses concurrent probes to one. |
| bun run lint | No new errors; warning cap honored. |
| c3x check --only c3-224 --only c3-210 --only c3-213 | Passes after c3x write updates and ADR Parent Delta. |
| Manual smoke: cap=2 on one token, two chats turn concurrently | Both chats receive responses; no "in use by" refusal; rotation on forced limit hits both chats and recovers. |
