---
id: adr-20260715-fix-derived-materials-optional-section-citations
c3-seal: 4a4fff6628ecb071f9ffb32b601e9b0c35b1837934f922735f57f2990d6c0112
title: fix-derived-materials-optional-section-citations
type: adr
goal: |-
    Ground the 15 "ungrounded derivation in Derived Materials … cite strict component sections" errors
    in c3-225, c3-227, c3-229, and c3-232 by prefixing every optional-section citation in the
    `Must derive from` column with its owning component ID. Required sections (Contract, Purpose, Goal)
    resolve without a prefix because the canvas guarantees their presence; optional sections (Change
    Safety, Foundational Flow, Business Flow) do not, so `c3 check` cannot ground the reference without
    the component ID.
status: done
date: "2026-07-15"
---

## Goal

Ground the 15 "ungrounded derivation in Derived Materials … cite strict component sections" errors
in c3-225, c3-227, c3-229, and c3-232 by prefixing every optional-section citation in the
`Must derive from` column with its owning component ID. Required sections (Contract, Purpose, Goal)
resolve without a prefix because the canvas guarantees their presence; optional sections (Change
Safety, Foundational Flow, Business Flow) do not, so `c3 check` cannot ground the reference without
the component ID.

## Context

Running `c3 check` against the current model yields 15 errors of the form
`ungrounded derivation in Derived Materials row N column Must derive from: cite strict component sections`.
All 15 are in four components whose Derived Materials rows cite optional canvas sections
(Change Safety, Foundational Flow, Business Flow) without the `<componentId> ` prefix.
Required sections (`Contract`, `Purpose`, `## Contract`) resolve structurally; optional ones require
the owning id for the tool to verify the section exists. The errors were introduced when rows for
test files were added after those optional sections were written, but before the strict-citation
requirement for optional sections was applied.

## Decision

Prefix every failing `Must derive from` value with `<componentId> `, keeping the rest of the cell
verbatim. No other cell or section is touched. Fifteen rows across c3-225/227/229/232 receive this
prefix; the fix is mechanical, content-preserving, and does not alter any architectural claim.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-225 | component | Rows 9–12 cite Change Safety without component ID prefix — 4 c3 check errors | c3-225#n7495@v1:sha256:9b87627475eab423c5ef2ec81644ed39f510b9e7f1c564c1cec4ab79fd43e889 | Derived Materials only; no contract change |
| c3-227 | component | Rows 2, 3, 6 cite Foundational Flow and Business Flow without component ID — 3 errors | c3-227#n7630@v1:sha256:b3f265492cae65e5b2b1714ac664b1dfb11f7abd1b60136d527be8b1a8027c1a | Derived Materials only; no contract change |
| c3-229 | component | Rows 11–17 cite Change Safety without component ID — 7 errors | c3-229#n7786@v1:sha256:089732f8d4d5a34b66134384099b9745281589fae37b1a4b5b44fefa96bc3278 | Derived Materials only; no contract change |
| c3-232 | component | Row 3 cites ## Business Flow without component ID — 1 error | c3-232#n7962@v1:sha256:1601b11d48bff9b37d2a7319de6291ca9d4a39d557c606106f4fa40db7e2171e | Derived Materials only; no contract change |

## Verification

| Check | Result |
| --- | --- |
| c3 check exits 0 with zero errors | Must pass after apply |
