---
id: adr-20260519-split-oauth-pool-from-auth
c3-seal: 8591470393fa096e0dd8c05f8ba61c62346377253364734289c693c8773e9359
title: split-oauth-pool-from-auth
type: adr
goal: Split OAuth multi-token rotation pool out of c3-203 (auth) into a new server-side component c3-224 (oauth-token-pool) so the documented surface matches the code. c3-203 explicitly declares OAuth a non-goal yet code-map.yaml has src/server/oauth-pool/** trained on it; the actual responsibilities (token state machine, per-chat reservation, rate-limit/auth-error rotation, refusal payload for the UI) need their own contract.
status: implemented
date: "2026-05-19"
---

## Goal

Split OAuth multi-token rotation pool out of c3-203 (auth) into a new server-side component c3-224 (oauth-token-pool) so the documented surface matches the code. c3-203 explicitly declares OAuth a non-goal yet code-map.yaml has src/server/oauth-pool/** trained on it; the actual responsibilities (token state machine, per-chat reservation, rate-limit/auth-error rotation, refusal payload for the UI) need their own contract.

## Context

Today src/server/oauth-pool/oauth-token-pool.ts owns four state buckets per OAuth token (active/limited/error/disabled), a per-chat reservation map preventing two concurrent chats from sharing one token, eligibility + auto-revive on pickActive, and a refusal classifier describeUnavailability landed in PR #235. The pool is consumed by c3-210 (agent-coordinator) on every Claude turn spawn and by both the SDK and PTY drivers for token rotation. c3-203's documented purpose is single launch-password cookie middleware — its body says "Non-goals: ... OAuth, multi-tenant auth". code-map.yaml line 67 maps src/server/oauth-pool/**/*.ts under c3-203, which makes c3x lookup return the wrong contract. CLAUDE.md mentions OAuth pool rotation only as a one-line PTY parity note; no doc covers reservation semantics, rotation flow, or the new refusal path that ws-router surfaces to ChatTranscriptViewport as a clickable link.

## Decision

Create c3-224 oauth-token-pool as a feature-category component under c3-2. Move src/server/oauth-pool/** to it in code-map.yaml. Document token state machine, per-chat 1:1 reservation (with subagent-same-chat exception), pickActive eligibility + LRU + revive, rotation flow consumed by c3-210 on rate-limit and auth-error detection, and the PR #235 refusal payload contract (markdown chat-link parsed by c3-112 chat-page). Update c3-203 derived materials to drop src/server/oauth-pool/**. No code change; this is documentation realignment only.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-203 | component | Owns code-map entry for src/server/oauth-pool/** today, must release it | Drop oauth-pool path from code-map; confirm Derived Materials still match |
| c3-2 | container | Components table must list the new oauth-token-pool component with goal contribution; child being introduced under this container | Append row for new component; verify parent Goal Slice still holds |
| c3-210 | component | Consumes oauth pool on every Claude turn spawn and rotation | Add wire to new component; document dependency in component body |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | Pool reads/writes settings under ~/.kanna/data via app-settings; binding stays local-first | comply |
| N.A - oauth pool state is settings-backed, not event-sourced; intentional out-of-scope for event log | N.A | N.A |
| ref-strong-typing | Public surface (OAuthTokenEntry, TokenUnavailability, EphemeralLease) must stay precisely typed at the chat/agent boundary | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Pool API crosses chat/agent boundary; no any / untyped patch payloads allowed | comply |
| rule-colocated-bun-test | oauth-token-pool.test.ts sits next to oauth-token-pool.ts (already true) | comply |
| N.A - rule-zustand-store does not apply: pool is server-side, not client zustand state | N.A | N.A |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| c3x add component | Create c3-224 oauth-token-pool under c3-2 with feature category | c3x add component c3-224 oauth-token-pool --container c3-2 |
| c3-224 body | Write Parent Fit, Purpose, Foundational Flow, Business Flow, Governance, Contract, Change Safety, Derived Materials | c3x write c3-224 --file body.md |
| code-map.yaml | Move src/server/oauth-pool/**/*.ts pattern from c3-203 to c3-224 | c3x set c3-203 codemap-remove; c3x set c3-224 codemap-add |
| c3-203 Derived Materials | Drop oauth-pool material rows from c3-203 if any | c3x write c3-203 --section "Derived Materials" |
| c3-2 Components | Append c3-224 row to Components table | c3x write c3-2 --section Components |
| Wire c3-224 | Wire c3-210 -> c3-224 dependency and any refs (ref-local-first-data, ref-strong-typing) | c3x wire c3-210 c3-224; c3x wire c3-224 ref-local-first-data; c3x wire c3-224 ref-strong-typing |
| Verify | Run c3x check after each mutation; ensure no drift | c3x check |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| .c3/code-map.yaml | Add c3-224: src/server/oauth-pool/**/*.ts; remove that pattern from c3-203 entry | c3x lookup src/server/oauth-pool/** returns c3-224 |
| .c3/c3-2-server/c3-224-oauth-token-pool.md | New component doc file created by c3x add | c3x read c3-224 --full |
| .c3/c3-2-server/c3-203-auth.md Derived Materials section | Confirm row set no longer references oauth-pool path | c3x read c3-203 --section "Derived Materials" |
| .c3/c3-2-server/README.md Components table | Append c3-224 row | c3x read c3-2 --section Components |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x lookup | Maps src/server/oauth-pool/** to c3-224 not c3-203 | c3x lookup src/server/oauth-pool/oauth-token-pool.ts |
| c3x check | Validates every component-file relationship and rejects drift | c3x check exits clean post-mutation |
| c3-224 Contract section | Names public surface (pickActive, pickEphemeral, markLimited, markError, markDisabled, markEnabled, markUsed, describeUnavailability, hasUsable, hasAnyToken, allLimited, earliestUnlimit) | c3x read c3-224 --section Contract |
| oauth-token-pool.test.ts | Existing unit tests assert state machine + reservation + refusal classification | bun test src/server/oauth-pool/ |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep oauth-pool under c3-203 and extend c3-203 to cover OAuth | c3-203 body explicitly lists OAuth as Non-goal; widening it conflates launch-password middleware with multi-account token rotation and breaks Parent Fit |
| Document oauth-pool only in CLAUDE.md | Defeats the c3 architecture-as-docs invariant: c3x lookup must surface the contract for any file; CLAUDE.md is unstructured prose, not the source of truth |
| Inline oauth-pool docs into c3-210 (agent-coordinator) | agent-coordinator is the consumer, not the owner; mixing the two hides the pool's state machine + reservation invariants that survive across multiple coordinator paths (SDK + PTY) |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| code-map.yaml ends up mapping oauth-pool to neither component | Apply add-to-c3-224 and remove-from-c3-203 in same change set, then c3x check | c3x lookup src/server/oauth-pool/oauth-token-pool.ts returns c3-224 |
| c3-2 Components table drifts (missing c3-224 row) | c3x check enforces parent-child link; verify with c3x graph c3-2 --depth 1 | c3x check && c3x graph c3-2 --depth 1 |
| c3-210 wire missing - dependency invisible | Explicit c3x wire c3-210 c3-224 step; verify via c3x graph c3-210 | c3x graph c3-210 --depth 1 |

## Verification

| Check | Result |
| --- | --- |
| c3x check after final mutation | issues: 0 |
| c3x lookup src/server/oauth-pool/oauth-token-pool.ts | components: c3-224 |
| c3x read c3-224 --section Contract | Lists pickActive/pickEphemeral/mark*/describeUnavailability surface |
| c3x graph c3-224 --depth 1 | Shows c3-2 parent + ref-local-first-data + ref-strong-typing + c3-210 dependency |
| c3x graph c3-2 --depth 1 | Includes c3-224 child node |
