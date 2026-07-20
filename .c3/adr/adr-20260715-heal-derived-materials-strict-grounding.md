---
id: adr-20260715-heal-derived-materials-strict-grounding
c3-seal: d8f000087a0a6a7f233f5ed49e25e9e0b8e5572a57fba15f7a2c1bc3f6136e37
title: heal-derived-materials-strict-grounding
type: adr
goal: Re-ground every "Must derive from" cell in the Derived Materials tables of components c3-225 (claude-pty-driver), c3-227 (auto-continue), c3-229 (workflow-status), and c3-232 (orchestration-core) so each cites at least one strict (required) component section, healing the 15 `ungrounded derivation` errors that currently make `c3 check` fail. This restores the C3 seal to a clean state without weakening the derivation contract.
status: accepted
date: "2026-07-15"
---

## Goal

Re-ground every "Must derive from" cell in the Derived Materials tables of components c3-225 (claude-pty-driver), c3-227 (auto-continue), c3-229 (workflow-status), and c3-232 (orchestration-core) so each cites at least one strict (required) component section, healing the 15 `ungrounded derivation` errors that currently make `c3 check` fail. This restores the C3 seal to a clean state without weakening the derivation contract.

## Context

`c3 check` reports 15 errors, all of the form `ungrounded derivation in Derived Materials row N column Must derive from: cite strict component sections`. The component canvas marks Goal, Parent Fit, Purpose, Governance, Contract, and Derived Materials as `req: true` (strict), while Foundational Flow, Business Flow, and Change Safety are `req: false` (optional). The validator requires each "Must derive from" cell to anchor derivation in at least one strict section. The 15 failing rows cite only an optional section: c3-225 rows 9-12 and c3-229 rows 11-17 cite `Change Safety` (test materials), c3-227 rows 2-3 cite `Foundational Flow` and row 6 cites `Business Flow`, and c3-232 row 3 cites `## Business Flow`. The already-passing c3-232 row 4 (`## Purpose and ## Business Flow`) proves the accepted shape: cite a strict section, optionally alongside the optional one. A broken seal is a blocker under the repo's "code-doc drift is a blocker" rule, so this must be healed before further architecture work lands.

## Decision

Edit each failing row's "Must derive from" cell to add the strict `Contract` grounding while preserving the original optional-section reference, following the accepted `<strict> and <optional>` pattern from c3-232 row 4. Test materials become `Contract and Change Safety` (they verify contract surfaces; Change Safety names the required verification). The auto-continue classifiers become `Contract and Foundational Flow (...)` and its e2e test `Contract and Business Flow (primary path)`. The orchestration e2e test becomes `## Contract and ## Business Flow`. This is preferred over simply replacing the optional section with `Contract`, because it keeps the honest semantic record of which optional section originally framed the material — no derivation intent is erased, only strict grounding is added. Material, Allowed variance, and Evidence cells are untouched; each edit is a single block-row patch anchored by the row's frozen node hash.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-225 | component | Derived Materials rows 9-12 (test materials) cite only the optional Change Safety section | c3-225#n7486@v1:sha256:199d3a40a280ff451f879641da9afed751e94872c0e2f792bd4a759aed664c1c | Re-ground to Contract and Change Safety; no Contract/Purpose change |
| c3-227 | component | Derived Materials rows 2, 3, 6 cite only optional Foundational Flow / Business Flow sections | c3-227#n7628@v1:sha256:199d3a40a280ff451f879641da9afed751e94872c0e2f792bd4a759aed664c1c | Re-ground to Contract and the original optional section |
| c3-229 | component | Derived Materials rows 11-17 (test materials) cite only the optional Change Safety section | c3-229#n7775@v1:sha256:199d3a40a280ff451f879641da9afed751e94872c0e2f792bd4a759aed664c1c | Re-ground to Contract and Change Safety; no Contract change |
| c3-232 | component | Derived Materials row 3 (e2e test) cites only the optional Business Flow section | c3-232#n7959@v1:sha256:199d3a40a280ff451f879641da9afed751e94872c0e2f792bd4a759aed664c1c | Re-ground to ## Contract and ## Business Flow |

## Verification

| Check | Result |
| --- | --- |
| c3 check | 0 errors (down from 15); exit 0 |
| c3 check --only c3-225 && c3 check --only c3-227 && c3 check --only c3-229 && c3 check --only c3-232 | each passes |
| c3 read c3-225 --section "Derived Materials" | rows 9-12 read "Contract and Change Safety"; Material/variance/Evidence unchanged |
