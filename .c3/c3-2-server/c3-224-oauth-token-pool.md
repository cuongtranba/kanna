---
id: c3-224
c3-seal: e0157a3a18ed369376bbc46f6339401e7c4416f7150e8d24ba1227be8c70b150
title: oauth-token-pool
type: component
category: feature
parent: c3-2
goal: 'Own the multi-token Anthropic OAuth pool: pick the right token per chat turn, prevent two chats from sharing one token, mark tokens limited/errored on detection, and surface a structured refusal when no token is usable.'
uses:
    - ref-local-first-data
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-strong-typing
---

# oauth-token-pool

## Goal

Own the multi-token Anthropic OAuth pool: pick the right token per chat turn, prevent two chats from sharing one token, mark tokens limited/errored on detection, and surface a structured refusal when no token is usable.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Drive multi-provider agent turns through a single coordinator" — sub-system covers Claude OAuth quota across multiple subscription accounts |
| Category | feature |
| Lifecycle | Single instance constructed at server boot, injected into AgentCoordinator and quick-response |
| Replaceability | Replaceable provided pickActive/pickEphemeral/markLimited/markError/describeUnavailability contract preserved |

## Purpose

Maintains an in-memory reservation index plus token state machine over the OAuth tokens persisted in app settings under `claudeAuth.tokens`. Selects the least-recently-used eligible token for each spawn via `pickActive(chatId)`, auto-revives tokens whose `limitedUntil` has elapsed, drops the reservation on `markLimited`/`markError`/`markDisabled` so the owning chat can rotate without an explicit release, and classifies why each token is unusable via `describeUnavailability(chatId)` for the refusal UI. Non-goals: the OAuth login flow itself (handled in settings UI), the launch-password gate (c3-203), persistent token storage (delegated to app-settings under c3-204/c3-206 boundary), event sourcing — pool state is settings-backed by design because tokens are user secrets, not derivable from the event log.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | At least one OAuth token configured via settings UI; tokens shape OAuthTokenEntry | c3-116 |
| Input — paths | Reads/writes claudeAuth.tokens via app-settings under ~/.kanna/data | c3-204 |
| Internal state | reservedBy Map<tokenId, chatId> in-memory only; resets on restart | c3-2 |
| Initialization | Constructed once at server boot with readTokens + writeStatus closures over app-settings | c3-202 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Claude turns run on the right subscription account; rate-limit on one token rotates to the next without user intervention | c3-210 |
| Primary path | pickActive(chatId) → markUsed → spawn subprocess with CLAUDE_CODE_OAUTH_TOKEN | c3-210 |
| Alternate — rotation | Rate-limit/auth-error detected → markLimited/markError drops reservation → pickActive picks next → token_rotation auto_continue event | c3-210 |
| Failure — refusal | No usable token + pool non-empty → OAuthPoolUnavailableError is caught in startTurnForChat and persisted to the chat transcript as a kind:"result", subtype:"error" entry whose result body is the describeUnavailability output (chat references rendered as /chat/<id> markdown links). Replaces the prior throw → commandError banner path, which flickered when the next snapshot tick wiped commandError. | c3-114 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Pool reads/writes token secrets via app-settings under ~/.kanna/data only | must follow | Tokens never sent to any non-Anthropic surface |
| ref-strong-typing | ref | OAuthTokenEntry, TokenStatusPatch, TokenUnavailability, EphemeralLease must stay precisely typed at the chat/agent boundary | must follow | No any in pool API |
| rule-strong-typing | rule | Boundary types enforced lint-level | must follow | Patch payload is Partial<Pick<...>>, not Record<string, unknown> |
| rule-colocated-bun-test | rule | oauth-token-pool.test.ts sits next to oauth-token-pool.ts | must follow | Existing test covers state machine + reservation + refusal |
| adr-20260519-split-oauth-pool-from-auth | adr | Decision to extract this component from c3-203 | must follow | Establishes parent fit and code-map ownership |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| pickActive(reservedFor?) | OUT | Returns LRU-eligible token for caller, binds reservation, revives expired-limited tokens; null when none eligible | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| pickEphemeral() | OUT | Returns EphemeralLease under synthetic key so concurrent ephemeral callers do not collide; caller MUST release() | c3-213 | src/server/oauth-pool/oauth-token-pool.ts |
| markLimited(id, resetAt) | IN | Marks token limited until resetAt; drops reservation so chat can re-pick | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| markError(id, message) | IN | Marks token errored (401); drops reservation; persists message | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| markUsed(id) / markDisabled / markEnabled | IN | Update lastUsedAt / status transitions | c3-116 | src/server/oauth-pool/oauth-token-pool.ts |
| release(reservedFor) | IN | Explicit drop of reservation when chat session closes | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| describeUnavailability(reservedFor?) | OUT | Returns per-token TokenUnavailability reasons so callers can build concrete refusals | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| hasAnyToken / hasUsable / allLimited / earliestUnlimit | OUT | Read-only probes for spawn-gate, schedule, and refusal logic | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Same token handed to two chats | Edits to isEligible/reservedBy semantics break the owner check | New chat returns a token already bound to another running chat | bun test src/server/oauth-pool/ + smoke 2 concurrent chats |
| TOCTOU between hasUsable preflight and pickActive | Eligibility predicate diverges between read-only and mutating paths | Refusal banner appears but pickActive would succeed (or vice versa) | bun test src/server/oauth-pool/ — hasUsable/pickActive parity tests |
| Expired-limited token never revived | revive logic skipped post-sort | Token remains limited past limitedUntil and never picked again | bun test src/server/oauth-pool/ — revive test |
| Refusal transcript entry loses chat reference | describeUnavailability output format changes, agent.ts buildPoolUnavailableMessage drift, or renderChatLinks regex drift | ResultMessage error body missing /chat/<id> link | bun test src/server/oauth-pool/ + src/client/components/messages/ResultMessage.test.tsx + manual refusal smoke (3 tokens, 2 limited, 1 reserved) |
| Reservation pinned across restart | reservedBy persisted (it must not be) | Restart cannot pick any token until manual fix | reservedBy lives in memory only — confirmed by private readonly reservedBy = new Map(...) in oauth-token-pool.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/oauth-pool/oauth-token-pool.ts | c3-224 Contract | Internal data structures may evolve as long as Contract surfaces hold | src/server/oauth-pool/oauth-token-pool.ts |
| src/server/oauth-pool/oauth-token-pool.test.ts | c3-224 Change Safety | Test names may evolve; coverage of state machine + reservation + describeUnavailability must remain | src/server/oauth-pool/oauth-token-pool.test.ts |
| agent.ts buildPoolUnavailableMessage + OAuthPoolUnavailableError | c3-224 Contract (describeUnavailability surface) | Wording may evolve; markdown chat-link format title is fixed (UI parser); error class identity is used by startTurnForChat catch to switch on refusal vs other failures | src/server/agent.ts buildPoolUnavailableMessage, OAuthPoolUnavailableError |
| renderChatLinks helper + ResultMessage error body | c3-224 Contract (describeUnavailability surface) | Regex may evolve; must keep accepting /chat/<uuid> link form | src/client/components/messages/renderChatLinks.tsx, src/client/components/messages/ResultMessage.tsx, src/client/app/ChatPage/ChatTranscriptViewport.tsx |
