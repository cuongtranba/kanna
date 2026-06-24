---
id: adr-20260624-reground-derives
c3-seal: 56917a2a2be91ea90883006dbfc2f17e4e62432eec8517ccaf1749dbbbd3609d
title: reground-derives
type: adr
goal: 'Fix two component doc cells that violate architecture accuracy: c3-103 Parent Fit Lifecycle uses the banned placeholder phrase "as needed"; c3-224 Derived Materials test row cites Change Safety (an optional section) instead of Contract (the strict section). Both cause canvas-grounding violations under the Derived-Materials rule and the placeholder-phrase rule. No code changes; docs-only alignment.'
status: implemented
date: "2026-06-24"
---

## Goal

Fix two component doc cells that violate architecture accuracy: c3-103 Parent Fit Lifecycle uses the banned placeholder phrase "as needed"; c3-224 Derived Materials test row cites Change Safety (an optional section) instead of Contract (the strict section). Both cause canvas-grounding violations under the Derived-Materials rule and the placeholder-phrase rule. No code changes; docs-only alignment.

## Context

The component canvas requires Derived Materials rows to cite strict required sections (Contract) so derivation evidence is anchored to the public interface, not to optional risk/flow sections. c3-224's `oauth-token-pool.test.ts` row currently names `c3-224 Change Safety` as its "Must derive from" source. Change Safety is an optional section; it provides risk/trigger guidance but is not the contract surface tests should ground on. The passing components that also have test rows (c3-226, c3-228) use `Contract` as the grounding. Separately, the component canvas bans the phrase "as needed" in any section body because it conveys zero information about actual lifecycle behaviour. c3-103 Parent Fit Lifecycle reads "Stateless React components, instantiated by features as needed", which triggers the placeholder rule. The accurate description is already in Foundational Flow: "Tree-shaken; imports happen lazily per consumer." Both components have exactly one offending cell, making a targeted `c3x write --section` patch sufficient.

## Decision

Re-point c3-224's `oauth-token-pool.test.ts` Derived Materials row from `c3-224 Change Safety` to `c3-224 Contract (state machine + reservation + describeUnavailability)`, naming the three Contract surfaces that the test file covers. This mirrors the c3-226/c3-228 pattern where test files derive from Contract. Reword c3-103's Lifecycle cell from "instantiated by features as needed" to "tree-shaken at build time; imported per consumer", sourcing the new wording from the existing Foundational Flow Initialization row so no new claim is introduced. Both changes land as single `c3x write --section` mutations in this work unit.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-103 | component | Parent Fit Lifecycle uses banned placeholder "as needed"; cell is inaccurate and triggers the canvas placeholder rule | c3-103 Parent Fit Lifecycle row | Canvas placeholder rule: banned phrase must be replaced with concrete lifecycle description |
| c3-224 | component | Derived Materials test row grounds on optional Change Safety section, not the strict Contract; violates canvas grounding rule for test files | c3-224 Derived Materials oauth-token-pool.test.ts row | Canvas Derived-Materials grounding rule: test files must cite Contract, not optional sections |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | c3-103 cites ref-strong-typing; Lifecycle reword is purely descriptive and does not alter typed-interface claims | review |
| ref-local-first-data | c3-224 cites ref-local-first-data; re-grounding the test row to Contract does not change any data-access boundary | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | c3-224 cites rule-colocated-bun-test; the test row must ground on the section whose surface the test covers — Contract, not Change Safety | comply |
| rule-strong-typing | c3-103 cites rule-strong-typing; Lifecycle cell fix is doc-only and does not change typed-interface obligations | review |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| c3-103 Parent Fit section | c3x write c3-103 --section "Parent Fit": replace Lifecycle row value "Stateless React components, instantiated by features as needed" with "Stateless React components, tree-shaken at build time; imported per consumer" | c3-103 Parent Fit, Foundational Flow Initialization row |
| c3-224 Derived Materials section | c3x write c3-224 --section "Derived Materials": change test row "Must derive from" cell from "c3-224 Change Safety" to "c3-224 Contract (state machine + reservation + describeUnavailability)" | c3-224 Derived Materials oauth-token-pool.test.ts row |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - doc-content patches only; no C3 CLI commands, validators, schemas, or tests are changed by this ADR | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check | Validates component canvas sections after write; reports any remaining schema violations | c3x check returns 0 issues after both section writes |
| Canvas placeholder rule | Rejects Lifecycle cells containing banned phrases at canvas validation time | Absence of "as needed" in c3-103 Parent Fit after write |
| Canvas grounding rule | Requires Derived Materials rows to cite strict sections; Change Safety is optional | c3-224 test row now cites Contract after write |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Make Change Safety a strict section (canvas morph) | Weakens the grounding contract repo-wide; the canvas intentionally grounds test materials on the interface Contract, not on optional risk/flow sections; this would silently validate the wrong pattern in all components |
| Delete the test row from Derived Materials | Passing components (c3-226, c3-228) list test files grounded in Contract; deletion loses real derivation evidence and diverges from the established pattern |
| Reword Lifecycle to "on demand" | Introduces another vague phrase; the accurate description is already in Foundational Flow ("tree-shaken; imports happen lazily per consumer") and should be used verbatim to avoid two conflicting lifecycle descriptions in the same doc |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Re-grounded test row names Contract surfaces the test does not actually cover | New grounding "Contract (state machine + reservation + describeUnavailability)" names exactly the three Contract surfaces covered by the existing test suite | bun test src/server/oauth-pool/oauth-token-pool.test.ts must pass after write |
| Lifecycle reword introduces a new claim not supported by code | Replacement text is sourced verbatim from c3-103 Foundational Flow Initialization row ("imports happen lazily per consumer"), so no new claim is added | c3x check --only c3-103 reports 0 issues; no cross-reference errors |

## Verification

| Check | Result |
| --- | --- |
| c3x check --only c3-103 | 0 issues; no canvas or schema errors |
| c3x check --only c3-224 | 0 issues; no canvas or schema errors |
| c3x check | 0 total issues; clean topology |
| bun test src/server/oauth-pool/oauth-token-pool.test.ts | All tests pass; re-grounded derivation matches actual coverage |
