---
id: adr-20260513-promote-refs-to-rules
c3-seal: 65c300282f6470f340235278f770afde9ce50f62ff8fcec6f61f1953b15f5fbc
title: promote-refs-to-rules
type: adr
goal: 'Promote three project-wide patterns from advisory refs into enforceable C3 rules so compliance is checked with literal Golden Examples, not directional prose. Targets: strong typing at boundaries, colocated Bun tests, Zustand store shape. The decision being authorized is to add `rule-strong-typing`, `rule-colocated-bun-test`, `rule-zustand-store` and re-wire every component currently citing the parent ref so the rule travels alongside the ref.'
status: implemented
date: "2026-05-13"
---

# promote-refs-to-rules

## Goal

Promote three project-wide patterns from advisory refs into enforceable C3 rules so compliance is checked with literal Golden Examples, not directional prose. Targets: strong typing at boundaries, colocated Bun tests, Zustand store shape. The decision being authorized is to add `rule-strong-typing`, `rule-colocated-bun-test`, `rule-zustand-store` and re-wire every component currently citing the parent ref so the rule travels alongside the ref.

## Context

The 2026-05-13 C3 audit (Phase 7/9) flagged three refs whose `## How` rows describe single-correct-form patterns (not preference) yet are stored as refs. Audit recommendation: promote to rules with literal Golden Examples from the repo. Refs cite 22 unique components total — `ref-strong-typing` (15), `ref-colocated-bun-test` (5), `ref-zustand-store` (5). Without rules, drift is detected only by reviewer judgment, so identical boilerplate variations slip through review. The change touches only C3 docs and `code-map.yaml`; no source code moves.

## Decision

Add three rule entities. Keep the parent refs (they retain Why/Choice context); rules add the enforceable one-line statement + Golden Example. Every component currently wired to the parent ref gets an additional `uses` link to the new rule via `c3x wire <component> <rule>`. Rule code-map entries reuse the parent ref's code-map so coverage signal is unchanged. Pattern: `rule-*` is the enforcement contract, `ref-*` is the rationale; both can coexist on a component.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| ref-strong-typing | ref | Becomes parent rationale; rule-strong-typing carries enforcement | Confirm ## How stays narrative; no enforcement leakage |
| ref-colocated-bun-test | ref | Same: rationale parent of rule-colocated-bun-test | Same |
| ref-zustand-store | ref | Same: rationale parent of rule-zustand-store | Same |
| c3-101 | component | Cites ref-strong-typing on WebSocket envelope types | Confirm Governance lists rule-strong-typing |
| c3-102 | component | Cites all three refs (state-stores hub) | Confirm Governance lists all three rules |
| c3-103 | component | Cites ref-strong-typing on UI prop types | Confirm Governance lists rule-strong-typing |
| c3-111 | component | Cites ref-zustand-store for sidebar store | Confirm Governance lists rule-zustand-store |
| c3-114 | component | Cites ref-strong-typing on transcript entry kinds | Confirm Governance lists rule-strong-typing |
| c3-115 | component | Cites ref-zustand-store for chat-ui chrome stores | Confirm Governance lists rule-zustand-store |
| c3-116 | component | Cites ref-zustand-store for settings store | Confirm Governance lists rule-zustand-store |
| c3-118 | component | Cites ref-zustand-store for terminal-workspace store | Confirm Governance lists rule-zustand-store |
| c3-205 | component | Cites ref-strong-typing on events union | Confirm Governance lists rule-strong-typing |
| c3-206 | component | Cites ref-colocated-bun-test for event-store tests | Confirm Governance lists rule-colocated-bun-test |
| c3-207 | component | Cites ref-strong-typing on read-model projections | Confirm Governance lists rule-strong-typing |
| c3-208 | component | Cites ref-colocated-bun-test for ws-router tests | Confirm Governance lists rule-colocated-bun-test |
| c3-209 | component | Cites ref-strong-typing on process-utils contracts | Confirm Governance lists rule-strong-typing |
| c3-210 | component | Cites ref-colocated-bun-test for agent-coordinator tests | Confirm Governance lists rule-colocated-bun-test |
| c3-211 | component | Cites ref-strong-typing on codex protocol | Confirm Governance lists rule-strong-typing |
| c3-219 | component | Cites ref-strong-typing on update-manager projection | Confirm Governance lists rule-strong-typing |
| c3-223 | component | Cites ref-strong-typing on cloudflare-tunnel projection | Confirm Governance lists rule-strong-typing |
| c3-301 | component | Cites ref-strong-typing — owns shared types | Confirm Governance lists rule-strong-typing |
| c3-302 | component | Cites ref-strong-typing — owns WS protocol envelopes | Confirm Governance lists rule-strong-typing |
| c3-303 | component | Cites ref-strong-typing AND ref-colocated-bun-test | Confirm Governance lists rule-strong-typing and rule-colocated-bun-test |
| c3-304 | component | Cites ref-strong-typing on port constants | Confirm Governance lists rule-strong-typing |
| c3-306 | component | Cites ref-strong-typing on share-shared types | Confirm Governance lists rule-strong-typing |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | Parent rationale for rule-strong-typing — rule cites ref as source-of-truth Why | review |
| ref-colocated-bun-test | Parent rationale for rule-colocated-bun-test | review |
| ref-zustand-store | Parent rationale for rule-zustand-store | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | This ADR creates it; one-line enforcement of no any at boundaries with Golden Example from src/shared/types.ts | create-rule |
| rule-colocated-bun-test | This ADR creates it; enforces <module>.test.ts(x) colocation with literal example from src/server/auth.test.ts | create-rule |
| rule-zustand-store | This ADR creates it; enforces create() + colocated test shape with literal example from src/client/stores/preferences.ts | create-rule |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| rule-strong-typing | c3x add rule strong-typing --file body.md with literal discriminated-union example from src/shared/types.ts | .c3/rules/rule-strong-typing.md |
| rule-colocated-bun-test | c3x add rule colocated-bun-test --file body.md with literal example from src/server/auth.test.ts | .c3/rules/rule-colocated-bun-test.md |
| rule-zustand-store | c3x add rule zustand-store --file body.md with literal preferences.ts content | .c3/rules/rule-zustand-store.md |
| Wire citations | c3x wire <component> <rule> for each of 25 component→rule edges (15 + 5 + 5; c3-102 cites all three; c3-303 cites two) | component frontmatter uses: |
| Code-map | c3x set <rule> codemap "<patterns>" mirroring parent ref's code-map | .c3/code-map.yaml |
| ADR transition | c3x set adr-20260513-promote-refs-to-rules status accepted then implemented after verify | adr frontmatter |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| .c3/rules/ | Three new files: rule-strong-typing.md, rule-colocated-bun-test.md, rule-zustand-store.md | c3x list shows three new rule rows |
| .c3/code-map.yaml | Three new top-level keys mirroring parent ref code-map patterns | grep '^rule-' .c3/code-map.yaml lists three keys |
| Component frontmatter uses: | 25 wire edges added across 22 components | c3x graph rule-strong-typing shows 15 inbound; rule-colocated-bun-test 5; rule-zustand-store 5 |
| Validator surface | None changed — c3x check already enforces rules require ## Rule + ## Golden Example and that citing components exist | c3x check exits 0 with 60 docs |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check Phase 7 | Rejects rule entities missing Rule + Golden Example | Three rules pass structural after add |
| c3x check orphan scan | Rejects rule with zero citing components | All three rules have ≥5 cites after wire |
| c3x lookup <file> | Returns rule id for matched source files so future edits surface rule constraint | c3x lookup src/shared/types.ts returns rule-strong-typing |
| Audit Phase 7b | Rule VIOLATION = FAIL severity; spot-check derives YES/NO from Rule + Golden Example | Rule body lists 1-3 YES/NO compliance questions in Not This or Scope |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Leave as refs only | Audit Phase 9 already flagged identical boilerplate in 5+ components as enforcement gap; refs can't be checked YES/NO |
| Replace refs with rules (delete refs) | Refs hold Why/Choice that doesn't fit one-line rule; schema says "Rule primarily about rationale → that's a ref, not a rule" |
| Promote only strong-typing | Audit found three patterns with single correct form; partial promotion leaves the other two gaps |
| Defer until next edit to each component | Coverage gain is per-edit; bulk wire pays once and immediately surfaces violations on every future c3x lookup |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Rule Golden Example drifts when src/shared/types.ts or auth.test.ts is refactored | Rule body cites file path explicitly; audit Phase 7b re-runs spot-check on referenced file | c3x check + cross-check Golden file exists via c3x lookup <golden-file> |
| Component uses both ref and rule with conflicting precedence | Rules strict, refs directional; rule wins per audit Phase 7b | Spot-check 2 components citing both; confirm rule is stricter subset of ref ## How |
| Wire edge missed | c3x graph <rule> --direction reverse lists every citer | Counts match: strong-typing inbound 15, colocated-bun-test 5, zustand-store 5 |

## Verification

| Check | Result |
| --- | --- |
| c3x check after all rules + wires applied | exits 0; 60 docs; zero issues |
| c3x graph rule-strong-typing --direction reverse | 15 inbound component edges |
| c3x graph rule-colocated-bun-test --direction reverse | 5 inbound component edges |
| c3x graph rule-zustand-store --direction reverse | 5 inbound component edges |
| c3x lookup src/shared/types.ts | matches include rule-strong-typing |
| c3x lookup src/client/stores/preferences.ts | matches include rule-zustand-store and ref-zustand-store |
| c3x lookup src/server/auth.test.ts | matches include rule-colocated-bun-test |
| bun test (full suite in worktree) | passes — no source code touched |
