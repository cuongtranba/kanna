---
id: adr-20260616-sdk-oauth-pool-account-parity
c3-seal: feb4b440c2f30909a73975ed6fa880fda8ed1fa5a737277e3a455f68f2a690b3
title: sdk-oauth-pool-account-parity
type: adr
goal: 'Make the SDK Claude driver emit the same OAuth-pool account info the PTY driver already emits at session init. Today SDK mode shows the raw SDK-reported account (`tokenSource: "CLAUDE_CODE_OAUTH_TOKEN"`, no pool-token name) while PTY mode shows the kanna OAuth-pool token name as `organization` and `tokenSource: "kanna-oauth-pool"` (UI renders "Pool token"). This ADR authorizes augmenting the SDK `account_info` transcript entry so both drivers present the picked pool token''s name and source identically.'
status: implemented
date: "2026-06-16"
---

## Goal

Make the SDK Claude driver emit the same OAuth-pool account info the PTY driver already emits at session init. Today SDK mode shows the raw SDK-reported account (`tokenSource: "CLAUDE_CODE_OAUTH_TOKEN"`, no pool-token name) while PTY mode shows the kanna OAuth-pool token name as `organization` and `tokenSource: "kanna-oauth-pool"` (UI renders "Pool token"). This ADR authorizes augmenting the SDK `account_info` transcript entry so both drivers present the picked pool token's name and source identically.

## Context

`AgentCoordinator.startTurnForChat` fetches account info via `turn.getAccountInfo()` and appends a single `account_info` transcript entry per session. For Claude, the only augmentation is `oauthKeyMasked` (agent.ts ~2181-2189). The picked OAuth-pool token's `label` is passed to the PTY starter (`oauthLabel`) but is NOT stored on the SDK `ClaudeSessionState` and is never applied to the SDK account info.

The PTY driver derives account info purely from the pool token via `deriveAccountInfoFromOauth({ label, oauthKeyMasked })` → `{ tokenSource: "kanna-oauth-pool", organization: label, oauthKeyMasked }` (claude-pty/driver.ts ~170). The SDK path instead trusts the SDK's own `q.accountInfo()`, which has no knowledge of the kanna pool token name. Result: inconsistent account display between drivers for the same pool token. Affected topology: c3-210 (agent-coordinator) SDK session path; the PTY behaviour in c3-225 is the parity reference (unchanged).

## Decision

Store the picked pool token label on the SDK `ClaudeSessionState` (`oauthLabel` (string-or-null), set from `picked?.label ?? null` at construction). In the `account_info` augmentation block, when the session was started with a pool token (`activeTokenId != null`), override `tokenSource` to `"kanna-oauth-pool"` and set `organization` to the stored label, in addition to the existing `oauthKeyMasked` augmentation. This mirrors `deriveAccountInfoFromOauth` while preserving the richer SDK-reported fields (email, subscriptionType) that PTY lacks. Augment-in-place (vs. importing the PTY helper) keeps the SDK's extra fields and avoids a cross-component import from c3-225 into c3-210.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | SDK session state + account_info augmentation changed | rule-strong-typing, ref-colocated-bun-test |
| c3-225 | component | Parity reference only (deriveAccountInfoFromOauth); no code change | N.A - read-only reference |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Account info is part of the normalized provider-agnostic transcript; both drivers must present it identically | comply |
| ref-colocated-bun-test | New behaviour needs a colocated test next to agent.ts | comply |
| ref-event-sourcing | account_info is an appended transcript event; augmentation happens before append | comply |
| ref-tool-hydration | Cited by c3-210; reviewed because the change lives in the same coordinator, but it edits the account_info entry only and never touches tool-call normalization or the hydration path | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New oauthLabel session field crosses the session-state boundary and must be a named typed field, not untyped | comply |
| rule-colocated-bun-test | Test must sit beside agent.ts as agent.*.test.ts under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Session state | Add oauthLabel (string-or-null) to ClaudeSessionState | src/server/agent.ts (~line 192) |
| Session construction | Set oauthLabel: picked?.label ?? null | src/server/agent.ts (~line 2405) |
| Account augment | When session.activeTokenId != null, set organization = oauthLabel and tokenSource = "kanna-oauth-pool" alongside oauthKeyMasked | src/server/agent.ts (~line 2181) |
| Test | Assert SDK account_info carries pool label as organization + kanna-oauth-pool source | src/server/agent.oauth-account-info.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI surface changed | This ADR changes product code only; no validator/schema/help/template change | N.A - product-only change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.oauth-account-info.test.ts | Fails if SDK account_info lacks the pool label as organization or the kanna-oauth-pool source | bun test src/server/agent.oauth-account-info.test.ts |
| bun run lint | Strong-typing seal catches untyped session field | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Import PTY deriveAccountInfoFromOauth and replace SDK account info wholesale | Discards SDK-reported email/subscriptionType and creates a c3-225→c3-210 import coupling; augment-in-place keeps both drivers' strengths |
| Leave SDK as-is (SDK-reported source only) | Fails the parity requirement; same pool token renders differently per driver |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Overriding a real SDK organization with the pool label | Only override when activeTokenId != null (a pool token was actually picked); non-pool sessions keep SDK fields untouched | agent.oauth-account-info.test.ts asserts no override when no pool token |
| Untyped session field regresses strong-typing seal | Declare oauthLabel (string-or-null) explicitly on ClaudeSessionState | bun run lint |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.oauth-account-info.test.ts | PASS — SDK account_info shows pool label + kanna-oauth-pool |
| bun run lint | PASS — no warnings, strong-typing seal holds |
| c3x check | PASS — no doc/code drift |
