---
id: adr-20260812-unbound-oauth-token-concurrency
c3-seal: d4c15162df2b370e0db749a5e75e344c9e4b40172bc68280b8d93c9b97f2c04e
title: unbound-oauth-token-concurrency
type: adr
goal: Remove the hard upper bound of 5 on the OAuth token pool's per-token concurrency cap. `OAuthTokenEntry.maxConcurrent` and `ClaudeAuthSettings.concurrencyDefault` are validated as integers at or above 1 with no ceiling, so an operator whose Anthropic subscription tolerates more than five concurrent chats per token can configure it without patching the source.
status: accepted
date: "2026-08-12"
---

## Goal

Remove the hard upper bound of 5 on the OAuth token pool's per-token concurrency cap. `OAuthTokenEntry.maxConcurrent` and `ClaudeAuthSettings.concurrencyDefault` are validated as integers at or above 1 with no ceiling, so an operator whose Anthropic subscription tolerates more than five concurrent chats per token can configure it without patching the source.

## Context

`adr-20260522-oauth-token-share-cap` introduced the cap and pinned it to `[1,5]` — a conservative guess at the point where sharing one token across chats starts drawing 429s, not a protocol limit. The bound was duplicated in three places that could drift: `OAUTH_TOKEN_MAX_CONCURRENT_MAX` in `src/shared/app-settings-types.ts` (settings validation + the Settings UI number inputs), and a second, independent `ABSOLUTE_MAX_CAP = 5` inside `OAuthTokenPool.tokenCap` — so even a hand-edited `settings.json` was silently re-clamped at pick time with no warning surfaced to the operator.

The ceiling is policy, and the operator owns the policy: they know their own subscription tier and rate-limit headroom. The floor is different — a cap below 1 would make a configured token unpickable, so the minimum stays a real invariant.

## Decision

Delete the ceiling; keep the floor. `src/shared/app-settings-types.ts` becomes the single source of truth for the bound, exporting `OAUTH_TOKEN_MAX_CONCURRENT_MIN` plus two pure helpers — `isTokenConcurrency(value)` (finite and rounds to at least the minimum) and `clampTokenConcurrency(raw)` (round, floor at the minimum, non-finite falls back to `OAUTH_TOKEN_CONCURRENCY_DEFAULT`).

All four consumers route through those helpers: the settings-file normalizer (warns and clamps only below the floor), `AppSettingsManager.setClaudeAuth` (throws only below the floor), `OAuthTokenPool.tokenCap` (its private `ABSOLUTE_MIN_CAP` / `ABSOLUTE_MAX_CAP` constants are deleted), and the Settings token-pool card (the `max` attribute is dropped from both number inputs; the helper text reads "Minimum 1, no upper limit").

Rejected: raising the ceiling to a larger constant (30, 100). It keeps the drift-prone duplication and only moves the arbitrary line — the operator still hits a number Kanna invented. Rate limiting is Anthropic's to enforce, and the pool already handles a 429 through `markLimited` + rotation.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-224 | component | tokenCap loses its private [1,5] clamp and delegates to the shared clampTokenConcurrency; the Contract row for pickActive and the Purpose paragraph both state the old range | c3-224#n9663@v1:sha256:428766414fffc747e48c1e887e0dc1c03cca54f0226a64fc6c0960d8c4663716 | Contract surfaces unchanged in shape; cap-admit / cap-reject tests extended for a cap above 5 |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | The cap is persisted with the token secrets in claudeAuth under ~/.kanna/data; loosening its validation must not move where the value lives or widen what leaves the machine | ref-local-first-data#n10648@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply |
| ref-strong-typing | The new isTokenConcurrency / clampTokenConcurrency helpers sit on the client↔server settings boundary; they take a declared number, never unknown, so callers narrow before the boundary | ref-strong-typing#n10752@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | no-restricted-syntax bans unknown in src/shared/**; the first draft of isTokenConcurrency(value: unknown) failed bun run lint and was narrowed to (value: number): boolean | rule-strong-typing#n10945@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |
| rule-colocated-bun-test | The shared helpers are new public surface and need a colocated suite: src/shared/app-settings-types.test.ts sits next to app-settings-types.ts, alongside the extended oauth-token-pool.test.ts | rule-colocated-bun-test#n10884@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/app-settings-types.test.ts src/server/oauth-pool/oauth-token-pool.test.ts src/server/app-settings.test.ts src/client/components/chat-ui/OAuthTokenPoolCard.test.tsx | 173 pass, 0 fail — covers cap 8 admitting eight chats, global default 7, high values surviving the settings normalizer, sub-minimum values clamped with a warning, and the UI inputs rendering min="1" with no max |
| bun run test | 5783 pass, 2 skip, 0 fail across 474 files |
| bun run lint / bun run typecheck | clean, --max-warnings=0 |
| grep -rIn for OAUTH_TOKEN_MAX_CONCURRENT_MAX or ABSOLUTE_MAX_CAP across src/ | no matches — the ceiling has exactly zero definitions left |
