---
id: adr-20260709-fix-c3-233-derived-materials
c3-seal: 079b8f9a834f99a985b76a43f6ad345f203d0f18c21eb1f22159f482320d15fc
title: fix-c3-233-derived-materials
type: adr
goal: |-
    Correct an ungrounded Derived Materials citation on component c3-233 (turn-recovery). Row 2
    (`src/server/turn-recovery/detect.test.ts`) declares its "Must derive from" as
    "Change Safety (all four walls)", but the component canvas has no "Change Safety" section, so the
    derivation cannot ground to a strict component section and `c3 check` fails. Re-anchor the row to
    the real `Contract` section it actually verifies, preserving the change-safety intent as prose.
status: accepted
date: "2026-07-09"
---

## Goal

Correct an ungrounded Derived Materials citation on component c3-233 (turn-recovery). Row 2
(`src/server/turn-recovery/detect.test.ts`) declares its "Must derive from" as
"Change Safety (all four walls)", but the component canvas has no "Change Safety" section, so the
derivation cannot ground to a strict component section and `c3 check` fails. Re-anchor the row to
the real `Contract` section it actually verifies, preserving the change-safety intent as prose.

## Context

c3-233 landed in commit d76119a (#493, graceful shutdown + crash-resilient turn resume). Its
Derived Materials table grounds each material to a component section. Rows 1 and 3 cite the
`Contract` section (a real canvas section) and pass; row 2 cites only "Change Safety", a phrase
that is not a canvas section (component sections are Goal, Parent Fit, Purpose, Governance,
Contract, Derived Materials, Foundational Flow, Business Flow). `c3 check` reports
"ungrounded derivation in Derived Materials row 2 column Must derive from: cite strict component
sections". This blocks a clean full `c3 check`. The fix is doc-only: `detect.test.ts` exercises the
same `detect` contract functions row 1 derives from, so the row must ground to `Contract`.

## Decision

Edit only Derived Materials row 2 to "Contract (detectResumableTurns, buildResumePrompt) + Change
Safety", mirroring row 3's grounded pattern (`Contract (...) + Change Safety`): the `Contract`
token grounds the derivation to a real section while the trailing "Change Safety" keeps the
four-walls intent readable. No behavior, contract surface, or code changes — a single block patch
on the frozen fact through a change-unit, which is the only legal path to mutate c3-233.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | Derived Materials row 2 re-grounded to the Contract section; no contract/behavior change | c3-233#n7850@v1:sha256:b2f7130e9908ca29cf946cb71789f9c056fa476dced4859576dac907048af49e "Detect turns left unfinished by a server crash or graceful deploy and auto-resume them on the next boot via the event-sourced auto-continue wake machinery." | Confirm the row grounds to a real section and the material's evidence path is unchanged |

## Verification

| Check | Result |
| --- | --- |
| c3 check (full, --include-adr) | PASS — c3-233 derivation grounds; no remaining errors |
| c3 change apply adr-...-fix-c3-233-derived-materials | Single block patch lands the row |
