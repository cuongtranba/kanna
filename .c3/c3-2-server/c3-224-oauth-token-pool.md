---
id: c3-224
c3-seal: e4fa6708633805800ee0f94fe0a5b76f0520ff50a1ef935a26af876b22ada94b
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

Maintains an in-memory refcounted reservation index (Map<tokenId, Set<chatId>>) plus the token state machine over the OAuth tokens persisted in app settings under `claudeAuth.tokens`. Selects an eligible token for each spawn via `pickActive(chatId)` with cap-aware spread-load semantics: per-token `maxConcurrent` (1–5) admits up to N concurrent chats on the same token, defaulting to `ClaudeAuthSettings.concurrencyDefault` when omitted. Owners are returned to the rotation layer in `agent.ts` via `takeStaleOwners(id)` before `markLimited` / `markError` so the layer can drive a deduped, staggered respawn for every shared owner (per `adr-20260522-oauth-token-share-cap`). Classifies why each token is unusable via `describeUnavailability(chatId)` for the refusal UI, naming every chat in the multi-owner case. Non-goals: the OAuth login flow itself (handled in settings UI), the launch-password gate (c3-203), persistent token storage (delegated to app-settings under c3-204 / c3-206 boundary), event sourcing — pool state is settings-backed by design because tokens are user secrets, not derivable from the event log.

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
| pickActive(reservedFor?) | OUT | Returns the LRU-eligible token for caller, binds reservation under refcounted Set<chatId>. A token admits up to tokenCap(token) distinct chats (per-token maxConcurrent or ClaudeAuthSettings.concurrencyDefault, clamped to [1,5]). Re-entrant pickActive returns the caller's already-owned token; otherwise spreads load by owner-count ASC then LRU. Revives expired-limited tokens. Null when none eligible. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| pickEphemeral() | OUT | Returns EphemeralLease under synthetic key so concurrent ephemeral callers (quick-response, subagent oneShot) do not collide. Counts against the picked token's cap; release() frees the slot. | c3-213 | src/server/oauth-pool/oauth-token-pool.ts |
| markLimited(id, resetAt) | IN | Marks token limited until resetAt; clears the local owner set. Caller MUST invoke takeStaleOwners(id) BEFORE markLimited to drive coordinated rotation for all shared owners. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| markError(id, message) | IN | Marks token errored (401); clears the local owner set. Same takeStaleOwners precondition as markLimited. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| markUsed(id) / markDisabled / markEnabled | IN | Update lastUsedAt / status transitions. markDisabled clears the owner set. | c3-116 | src/server/oauth-pool/oauth-token-pool.ts |
| takeStaleOwners(id) | OUT | Returns the current owner list for a token and clears it. Called by the rotation layer immediately before mark{Limited,Error} so it learns every chat sharing the now-dead token and can stagger their respawns. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| release(reservedFor) | IN | Drops the caller from every token's owner set; deletes a set entry when empty. Refcounted across cap-shared tokens. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| describeUnavailability(reservedFor?) | OUT | Returns per-token TokenUnavailability reasons. When at cap, reason "reserved" carries byChatIds: string[] (the full owner list) and ownedBySelf for self-aware UI. | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |
| hasAnyToken / hasUsable / allLimited / earliestUnlimit | OUT | Read-only probes for spawn-gate, schedule, and refusal logic. hasUsable honors the same cap-aware eligibility predicate as pickActive (TOCTOU closed). | c3-210 | src/server/oauth-pool/oauth-token-pool.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Cap exceeded by concurrent picks | Edits to isEligible / pickActive admit more than tokenCap(token) chats | New chat returns a token already at cap | bun test src/server/oauth-pool/oauth-token-pool.test.ts (cap-admit + cap-reject cases) |
| TOCTOU between hasUsable preflight and pickActive | Eligibility predicate diverges between read-only and mutating paths under cap-aware logic | Refusal banner appears but pickActive would succeed (or vice versa) | bun test src/server/oauth-pool/oauth-token-pool.test.ts — hasUsable/pickActive parity tests |
| Expired-limited token never revived | Revive logic skipped post-sort | Token remains limited past limitedUntil and never picked again | bun test src/server/oauth-pool/oauth-token-pool.test.ts — revive test |
| Refcount leak — release frees a slot still in use by another chat | release(chatId) clobbers entire Set instead of removing the single chat | A shared token reports fewer owners than reality; cap admits over the limit | bun test src/server/oauth-pool/oauth-token-pool.test.ts — release refcount case |
| Rotation herd when N owners simultaneously detect limit/401 on shared token | acquireRotationSlot in agent.ts does not dedupe within TOKEN_ROTATION_DEDUPE_WINDOW_MS or skips stagger application | All N respawns fire at once; PTY cold-boot stampede; second pickActive on same chatId double-claims | Existing bun test src/server/agent.oauth-rotation.test.ts + manual smoke (cap=2 on one token, force 401, observe staggered respawn) |
| PTY smoke-probe race on cold cache | smoke-test.ts singleflight removed or keyed wrong | Two concurrent probes hit Anthropic on the same OAuth token at boot — 429 cascade | bun test src/server/claude-pty/smoke-test.test.ts — singleflight collapse case |
| Refusal transcript entry loses chat reference | describeUnavailability output format changes, agent.ts buildPoolUnavailableMessage drift, or renderChatLinks regex drift | ResultMessage error body missing /chat/<id> links for the multi-owner case | bun test src/server/oauth-pool/ + src/client/components/messages/ResultMessage.test.tsx |
| Reservation pinned across restart | reservedBy persisted (it must not be) | Restart cannot pick any token until manual fix | reservedBy lives in memory only — confirmed by private readonly reservedBy = new Map(...) in oauth-token-pool.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/oauth-pool/oauth-token-pool.ts | c3-224 Contract | Internal data structures may evolve as long as Contract surfaces hold | src/server/oauth-pool/oauth-token-pool.ts |
| src/server/oauth-pool/oauth-token-pool.test.ts | c3-224 Change Safety | Test names may evolve; coverage of state machine + reservation + describeUnavailability must remain | src/server/oauth-pool/oauth-token-pool.test.ts |
| agent.ts buildPoolUnavailableMessage + OAuthPoolUnavailableError | c3-224 Contract (describeUnavailability surface) | Wording may evolve; markdown chat-link format title is fixed (UI parser); error class identity is used by startTurnForChat catch to switch on refusal vs other failures | src/server/agent.ts buildPoolUnavailableMessage, OAuthPoolUnavailableError |
| renderChatLinks helper + ResultMessage error body | c3-224 Contract (describeUnavailability surface) | Regex may evolve; must keep accepting /chat/<uuid> link form | src/client/components/messages/renderChatLinks.tsx, src/client/components/messages/ResultMessage.tsx, src/client/app/ChatPage/ChatTranscriptViewport.tsx |
