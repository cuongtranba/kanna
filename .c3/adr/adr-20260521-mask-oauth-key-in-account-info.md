---
id: adr-20260521-mask-oauth-key-in-account-info
c3-seal: 9884d3869b5f942aa2623fe3e503a1bead2a7368947a9158f4efdfb729232097
title: mask-oauth-key-in-account-info
type: adr
goal: Replace the OAuth-pool token label with a masked OAuth key (e.g. `sk-ant-oat01-...XXXX`) as the primary identifier shown in the chat `AccountInfoMessage`. The label remains available in the expanded panel as "Organization". The masked key surfaces in both the collapsed row and the expanded "OAuth key" code block in place of the label echo that ships today (#254). Full token value is never serialized to the JSONL event store or rendered in any UI surface.
status: proposed
date: "2026-05-21"
---

## Goal

Replace the OAuth-pool token label with a masked OAuth key (e.g. `sk-ant-oat01-...XXXX`) as the primary identifier shown in the chat `AccountInfoMessage`. The label remains available in the expanded panel as "Organization". The masked key surfaces in both the collapsed row and the expanded "OAuth key" code block in place of the label echo that ships today (#254). Full token value is never serialized to the JSONL event store or rendered in any UI surface.

## Context

`AccountInfoMessage.tsx` reads `organization` (= OAuth token label from `OAuthTokenPool`) as `primaryKey` and shows the same label in the expanded "OAuth key" `MetaCodeBlock`. Operators who run multiple pool tokens with non-unique labels cannot tell which underlying credential served a given turn from chat alone. The recent #254 work surfaced the field but still echoed the label.

`AccountInfo` lives in `src/shared/types.ts` and crosses the WS boundary as part of `account_info` transcript entries persisted to the JSONL event log. Both the SDK driver (`q.accountInfo()`) and the PTY driver (`deriveAccountInfoFromLabel`) feed the same shape. The actual `OAuthTokenEntry.token` value is held in-process by `OAuthTokenPool` and is never persisted today; the design must keep it that way — only a non-reversible mask of the key is appended to the event log.

## Decision

Add `oauthKeyMasked?: string` to `AccountInfo`. Compute it in `AgentCoordinator` at the point a turn is started with a pool-picked token, from `picked.token` via a new shared `maskOauthKey(token)` helper that returns `<prefix-12>...<suffix-4>` for tokens of length ≥ 20 and `***` otherwise. Pass `oauthKeyMasked` into the PTY driver alongside `oauthLabel`; `deriveAccountInfoFromLabel` becomes `deriveAccountInfoFromOauth({ label, oauthKeyMasked })`. For the SDK driver, augment the `accountInfo` returned by `q.accountInfo()` with `oauthKeyMasked` before appending the event. The renderer prefers `oauthKeyMasked` over `organization` / `email` as the primary identifier and the expanded "OAuth key" block; label moves to a dedicated "Organization" row regardless of equality with `primaryKey`. No raw token ever leaves `AgentCoordinator`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | New field oauthKeyMasked on AccountInfo interface — crosses client↔server WS boundary. | rule-strong-typing |
| c3-210 | component | Masks picked.token and augments accountInfo before appending the account_info event for both providers. | rule-colocated-bun-test, rule-strong-typing |
| c3-225 | component | StartClaudeSessionPtyArgs gains oauthKeyMasked; deriveAccountInfoFromLabel renamed / rewritten to read both label and masked key. | rule-colocated-bun-test, rule-strong-typing |
| c3-114 | component | AccountInfoMessage.tsx uses oauthKeyMasked as primary identifier; "Organization" row always rendered when label present. | rule-strong-typing |
| c3-224 | component | No schema change; picked.token consumed by the new masker. Read of OAuthTokenEntry.token is already in-coordinator. | N.A - read-only consumer |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New optional field on a shared boundary type; mask helper return shape must be string, never any. | comply |
| ref-local-first-data | Masked key persists to local JSONL event log under ~/.kanna/data; raw token must not. | comply |
| ref-colocated-bun-test | New unit tests for the masker and for the augmentation path live alongside their source files. | comply |
| ref-event-sourcing | account_info entries are appended to the JSONL log and replayed; new field must survive replay losslessly. | comply |
| ref-provider-adapter | SDK and PTY paths must produce identical AccountInfo shape for the same pool token. | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New field added to a cross-boundary interface; no any. | comply |
| rule-colocated-bun-test | New mask-oauth-key.test.ts next to mask-oauth-key.ts; agent + driver tests extend existing *.test.ts siblings. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Mask helper | Add src/shared/mask-oauth-key.ts exporting maskOauthKey(token: string): string returning <first-12>...<last-4> for length ≥ 20, otherwise ***. | new file + colocated test |
| Shared type | Add oauthKeyMasked?: string to AccountInfo in src/shared/types.ts. | diff on types.ts |
| Agent coordinator | At both startTurn and runSubagent sites that hold picked, compute oauthKeyMasked once, pass into driver args, and augment SDK accountInfo before appendMessage of the account_info event. | diff on src/server/agent.ts lines 1525-1535, 1980-1998, 2130-2140 |
| PTY driver | Add oauthKeyMasked?: string to StartClaudeSessionPtyArgs; rewrite deriveAccountInfoFromLabel as deriveAccountInfoFromOauth({ label, oauthKeyMasked }) returning { organization?, oauthKeyMasked?, tokenSource: "kanna-oauth-pool" } when either field is present; thread arg through cachedAccountInfo seed. | diff on src/server/claude-pty/driver.ts lines 77-89, 345 |
| Renderer | AccountInfoMessage.tsx: primaryKey = oauthKeyMasked ?? organization ?? email ?? "Unknown account"; "Organization" row in expanded panel renders whenever organization is set (not only when organization !== primaryKey). | diff on AccountInfoMessage.tsx |
| Tests | New src/shared/mask-oauth-key.test.ts; extend src/server/agent.test.ts and src/server/claude-pty/driver.test.ts for the augmented AccountInfo. No raw-token leak assertion in the agent test (assert masked output only). | bun test src/shared/mask-oauth-key.test.ts src/server/agent.test.ts src/server/claude-pty/driver.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| codemap | None — affected files already under existing component patterns. | c3x check clean after edits |
| component bodies | None — responsibilities unchanged. | c3x list topology unchanged |
| ADR | This ADR added under .c3/adr/adr-20260521-mask-oauth-key-in-account-info.md. | c3x list --include-adr shows the ADR |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/mask-oauth-key.test.ts | Asserts mask format and that no input substring of length > 4 leaks past the suffix. | bun test src/shared/mask-oauth-key.test.ts |
| src/server/agent.test.ts | Asserts account_info event appended after pool pick carries oauthKeyMasked and never carries picked.token. | bun test src/server/agent.test.ts |
| src/server/claude-pty/driver.test.ts | Asserts getAccountInfo() returns oauthKeyMasked when seeded from oauthKeyMasked arg. | bun test src/server/claude-pty/driver.test.ts |
| TypeScript build | Optional field on AccountInfo flows through hydrated transcript type into the renderer prop. | bun run lint + bun run build |
| c3x check | No drift after ADR + ref/rule wiring. | bash .../c3x.sh check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Show full OAuth token in chat | User explicitly chose masking; full token in JSONL event log is a credential-leak vector. |
| Show only token id (OAuthTokenEntry.id) | The id is internal; the masked key prefix/suffix lets the operator cross-reference settings UI which displays the same shape. |
| Keep label as primary, add masked key only in expanded view | User asked to replace name in primary view; partial change keeps the ambiguity for collapsed display. |
| Compute mask in renderer from a new oauthKey field | Would require serializing full token through WS + JSONL — exactly the leak surface this ADR avoids. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Raw token accidentally serialized | Mask helper is the only path to oauthKeyMasked; coordinator never reads picked.token outside the masker call site. | Unit test in agent.test.ts asserts appended event contains no substring of picked.token beyond the 4-char suffix. |
| SDK driver accountInfo shape regression | Augmentation is additive; existing fields unchanged. | bun test src/server/agent.test.ts |
| PTY parity-matrix drift | parity-matrix.test.ts does not assert on oauthKeyMasked (SDK path has it, CLI stream never emits it); augmentation happens in coordinator, not driver stream. | bun test src/server/claude-pty/parity-matrix.test.ts |
| Short / malformed tokens (length < 20) | Helper returns *** rather than leaking prefix. | Unit test case in mask-oauth-key.test.ts |
| Existing replayed account_info events from JSONL lack the field | Field is optional; renderer falls back to organization/email. | Manual replay smoke against an existing chat (no migration needed). |

## Verification

| Check | Result |
| --- | --- |
| bun test src/shared/mask-oauth-key.test.ts | passes |
| bun test src/server/agent.test.ts src/server/claude-pty/driver.test.ts | passes |
| bun test (whole suite) | passes |
| bun run lint | 0 errors, warnings ≤ current cap |
| bash <skill>/bin/c3x.sh check | clean |
| Manual: start a chat under PTY with an OAuth-pool token, confirm primary row shows sk-ant-...XXXX and expanded "Organization" row shows the label. | matches |
