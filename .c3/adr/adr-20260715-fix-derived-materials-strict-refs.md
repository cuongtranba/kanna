---
id: adr-20260715-fix-derived-materials-strict-refs
c3-seal: 745e655fe3f851af43e2f35ff2083840926a3730d19ec226b6dcc4738f080f04
title: fix-derived-materials-strict-refs
type: adr
goal: |-
    Fix 15 `c3x check` errors of the form "ungrounded derivation in Derived
    Materials row N column Must derive from: cite strict component sections"
    across `c3-225`, `c3-227`, `c3-229`, `c3-232`. Each offending row's "Must
    derive from" cell names a section that is not a strict grounding section
    (`Foundational Flow`, `Business Flow`, `Change Safety` — all narrative/
    procedural sections that sit AFTER `Derived Materials` in the component
    canvas's section order) instead of a strict one (`Contract`, or `Purpose`).
    Re-point every offending cell at `Contract` (preserving any parenthetical
    detail already present, or adding one for context where useful), matching
    the convention already used successfully by every passing row in these
    same tables and by sibling components (`c3-206`, `c3-208`, `c3-210`).
status: accepted
date: "2026-07-15"
---

# Fix ungrounded Derived Materials refs (strict-section citation)

## Goal

Fix 15 `c3x check` errors of the form "ungrounded derivation in Derived
Materials row N column Must derive from: cite strict component sections"
across `c3-225`, `c3-227`, `c3-229`, `c3-232`. Each offending row's "Must
derive from" cell names a section that is not a strict grounding section
(`Foundational Flow`, `Business Flow`, `Change Safety` — all narrative/
procedural sections that sit AFTER `Derived Materials` in the component
canvas's section order) instead of a strict one (`Contract`, or `Purpose`).
Re-point every offending cell at `Contract` (preserving any parenthetical
detail already present, or adding one for context where useful), matching
the convention already used successfully by every passing row in these
same tables and by sibling components (`c3-206`, `c3-208`, `c3-210`).

## Context

Discovered while running `c3x check` ahead of an unrelated chunk
(Phase 0+1a of the Zustand/React-Query/react-use-websocket client
migration, tracked in `PROGRESS.md`). `c3x check` reports 15 pre-existing
errors, all "ungrounded derivation ... cite strict component sections",
none touching entities involved in that migration. The component canvas's
`Derived Materials` section requires "Must derive from" to cite a strict
(authoritative) section of the SAME component — `Goal`/`Purpose`/
`Governance`/`Contract`, the sections that precede `Derived Materials` in
canvas order — not a narrative flow/safety section that comes after it.
These 4 components' Derived Materials tables were authored (or grew rows)
before this stricter check existed, citing `Foundational Flow`,
`Business Flow`, or `Change Safety` for several rows (mostly test files).
Confirmed via `c3x read <id> --section "Derived Materials"` on the 4
flagged components plus 3 passing sibling components (`c3-206`, `c3-208`,
`c3-210`) whose test-file rows already say `Contract` (or `<id> Contract`)
and pass clean.

## Decision

Re-point every flagged "Must derive from" cell to `Contract` (preserving
parentheticals / the `## `-prefixed local style, per the original decision
below), landed via **direct edit of the canonical `.c3/` markdown files +
`c3x repair`**, NOT via `change apply` with the 15-patch change-unit
originally authored for this ADR.

**Deviation and why:** exhaustive empirical testing (full 15-patch dry-run,
an isolated single-patch dry-run, a multi-row-body single-patch dry-run, and
a comma-joined multi-base dry-run) proved `c3x` 11.6.2's `change apply`
canvas gate validates each patch **in isolation against the pristine
baseline**, requiring the WHOLE resulting Derived Materials table to have
ZERO errors from that one patch alone — it does not evaluate sibling patches
in the same change-unit cumulatively, even when they target the same
entity/table. Block-patch granularity is exactly one table row; multi-line
patch bodies are not parsed as multiple rows; `base:` rejects
comma-joined/multiple cite handles. Net effect: any entity with 2+
simultaneously-broken Derived Materials rows (`c3-225`: 4, `c3-227`: 3,
`c3-229`: 7) cannot be fixed via ANY patch/change-unit combination in this
c3x version — only `c3-232` (1 broken row) could apply normally in
isolation. This is a genuine tool limitation, not a patch-authoring
mistake. Per explicit user instruction ("create a script to fix it once"),
the fix was applied directly to the canonical markdown (still hand-editable
here since ADR-fact freeze does not extend to bypassing a proven-broken
apply path for a doc-only cell correction), followed by `c3x repair` to
rebuild the cache/reseal. The original 15-patch change-unit folder is
retained for evidentiary/history purposes but was never applied and cannot
be; see the change folder's own note.

Original per-row decision (unchanged): where the cell had a parenthetical
qualifier (`Foundational Flow (rate-limit classifier)`), the qualifier is
kept under `Contract` (`Contract (rate-limit classifier)`). Where the cell
already used a `## `-prefixed style (`c3-232`), that component's own local
style is kept (`## Contract`). Rejected alternative (unchanged): broadening
the "strict sections" allowlist to include `Foundational Flow`/`Business
Flow`/`Change Safety` — rejected because it would blur Derived Materials'
purpose and the checker's own pre-Derived-Materials-only strictness is
intentional per schema ordering.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-225 | component | 4 Derived Materials rows (driver.test.ts, tui-control.test.ts, pty-cli-args.test.ts, pty-memory-sampler.adapter.test.ts) cite Change Safety, not a strict section | c3-225#n7477@v1:sha256:9b87627475eab423c5ef2ec81644ed39f510b9e7f1c564c1cec4ab79fd43e889 | Doc-only cell fix; no code/contract change |
| c3-227 | component | 3 rows (limit-detector.ts, auth-error-detector.ts cite Foundational Flow; e2e.test.ts cites Business Flow) are not strict | c3-227#n7612@v1:sha256:b3f265492cae65e5b2b1714ac664b1dfb11f7abd1b60136d527be8b1a8027c1a | Doc-only cell fix; no code/contract change |
| c3-229 | component | 7 rows (all *.test.ts / *.test.tsx) cite Change Safety, not a strict section | c3-229#n7768@v1:sha256:089732f8d4d5a34b66134384099b9745281589fae37b1a4b5b44fefa96bc3278 | Doc-only cell fix; no code/contract change |
| c3-232 | component | 1 row (orchestration-e2e.test.ts) cites ## Business Flow, not a strict section | c3-232#n7944@v1:sha256:1601b11d48bff9b37d2a7319de6291ca9d4a39d557c606106f4fa40db7e2171e | Doc-only cell fix; no code/contract change |

## Verification

| Check | Result |
| --- | --- |
| c3x check --only c3-225 | exits 0, no errors |
| c3x check --only c3-227 | exits 0, no errors |
| c3x check --only c3-229 | exits 0, no errors |
| c3x check --only c3-232 | exits 0, no errors |
| c3x check (full, project) | 0 errors (down from 15), confirmed after direct-edit + c3x repair |
| c3x change apply (this ADR's 15-patch unit) | proven unappliable for c3-225/227/229 (2+ broken rows per entity); never run; superseded by direct edit |
