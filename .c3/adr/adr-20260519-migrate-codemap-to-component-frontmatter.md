---
id: adr-20260519-migrate-codemap-to-component-frontmatter
c3-seal: 1781b01eb250081920906800e65c970f7f29f12cfaca89d38893eaa98c40bd7e
title: migrate-codemap-to-component-frontmatter
type: adr
goal: |-
    Repair the C3 code map so the bundled c3x 9.9.0 owns it. The hand-edited
    `.c3/code-map.yaml` was unsealed and carried 9 unsupported `ref-*`
    codemap entries, which made `c3x check`/`repair` report
    `ONLY_IN_TREE code-map.yaml` + "canonical markdown drift" and made
    `c3x lookup <file>` return empty. The decision being authorized:
    re-author the code map through `c3x set <component-id> codemap` for all
    41 components so c3x writes and seals a component-only `code-map.yaml`,
    and let c3x drop the `ref-*` entries (refs are governed via component
    `uses` wiring, not codemap). This restores `c3x lookup`, `c3x check`,
    and `c3x repair`.
status: implemented
date: "2026-05-19"
---

## Goal

Repair the C3 code map so the bundled c3x 9.9.0 owns it. The hand-edited
`.c3/code-map.yaml` was unsealed and carried 9 unsupported `ref-*`
codemap entries, which made `c3x check`/`repair` report
`ONLY_IN_TREE code-map.yaml` + "canonical markdown drift" and made
`c3x lookup <file>` return empty. The decision being authorized:
re-author the code map through `c3x set <component-id> codemap` for all
41 components so c3x writes and seals a component-only `code-map.yaml`,
and let c3x drop the `ref-*` entries (refs are governed via component
`uses` wiring, not codemap). This restores `c3x lookup`, `c3x check`,
and `c3x repair`.

## Context

The skill bundles c3x 9.9.0. The project's `.c3/` is doc-format
`c3-version: 4`. The code map lived only in a hand-curated
`.c3/code-map.yaml` (211 lines: 41 component blocks + 9 `ref-*`
blocks) that was never authored through c3x, so it sat outside the
canonical seal. Symptoms: `c3x check`/`repair` reported
`ONLY_IN_TREE code-map.yaml` and "canonical markdown drift detected";
`c3x lookup <any file>` returned empty `matches:`; `c3x repair`
"resolved" the drift by deleting the whole file, destroying the only
file→component map. CLAUDE.md mandates `c3x lookup <file>` before ANY
code edit, so the mandated workflow was broken. c3x 9.9.0 stores the
code map in a c3x-managed, sealed `code-map.yaml` written via
`c3x set <id> codemap "<patterns>"`; it does not support `ref-*`
codemap blocks (audit Phase 9: "Ref WITH code-map file patterns →
VIOLATION"). Affected topology: every component in containers c3-1
(Client, 12), c3-2 (Server, 23), c3-3 (Shared, 6).

## Decision

Run `c3x set <component-id> codemap "<comma-separated patterns>"` for
all 41 components, copying the exact glob/path lists verbatim from the
original `code-map.yaml` (recovered from git HEAD). c3x re-authors and
seals `code-map.yaml` as a c3x-managed, component-only artifact and
drops the 9 `ref-*` blocks automatically. The file is kept (not
deleted) — c3x owns it as sealed canonical state. `ref-*` codemap is
intentionally not retained: c3x 9.9.0 surfaces governing refs for a
file through the owning component's `uses` wiring (verified: a lookup
of `src/server/agent.ts` returns c3-210 plus its 4 governing refs +
1 rule), and Phase 9 flags ref codemap as a VIOLATION. Right fit:
aligns the doc store with the bundled CLI's actual data model, zero
source-code changes, mechanical + verifiable, component coverage
provably unchanged (component blocks byte-identical to HEAD).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-1 | container | All 12 client component codemap blocks re-authored through c3x | Component blocks byte-identical to HEAD; no boundary/responsibility change |
| c3-2 | container | All 23 server component codemap blocks re-authored through c3x | Component blocks byte-identical to HEAD; no boundary/responsibility change |
| c3-3 | container | All 6 shared component codemap blocks re-authored through c3x | Component blocks byte-identical to HEAD; no boundary/responsibility change |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-colocated-bun-test | Cited by affected components (c3-102,206,208,210,303); this ADR only re-authors their codemap blocks, not their code | N.A - codemap-only reseal; no code change to review for compliance |
| ref-cqrs-read-models | Cited by affected components (c3-110,111,112,207,208,219,223); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-event-sourcing | Cited by affected components (c3-205,206,210); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-local-first-data | Cited by affected components (c3-116,117,201,202,203,204,206,214,217,218,221,222,305); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-provider-adapter | Cited by affected components (c3-113,115,210,211,212,213); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-strong-typing | Cited by affected components (c3-101,102,103,114,205,207,209,211,219,223,301,302,303,304,306); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-tool-hydration | Cited by affected components (c3-113,114,210,215,303); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-ws-subscription | Cited by affected components (c3-101,110,112,117,118,202,208,216,220,223,302); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| ref-zustand-store | Cited by affected components (c3-102,111,115,116,118); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Cited by affected components (c3-102,206,208,210,303); this ADR only re-authors their codemap blocks, not their code | N.A - codemap-only reseal; no code change to review for compliance |
| rule-strong-typing | Cited by affected components (c3-101,102,103,114,205,207,209,211,219,223,301,302,303,304,306); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |
| rule-zustand-store | Cited by affected components (c3-102,111,115,116,118); codemap blocks re-authored, code untouched | N.A - codemap-only reseal; no code change to review for compliance |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Recover source map | git show HEAD:.c3/code-map.yaml → parse 41 component key→patterns pairs | /tmp/c3_pairs.tsv, 41 rows |
| Component codemap (client) | c3x set <id> codemap "<patterns>" for c3-101,102,103,110..118 | original code-map.yaml lines 1-56 |
| Component codemap (server) | c3x set <id> codemap "<patterns>" for c3-201..c3-223 | original code-map.yaml lines 57-158 |
| Component codemap (shared) | c3x set <id> codemap "<patterns>" for c3-301..c3-306 | original code-map.yaml lines 159-174 |
| c3x re-seal | c3x set re-authors + seals code-map.yaml; ref-* blocks dropped by c3x | git diff = 37 deletions (9 ref-* keys only), 0 additions |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| code-map.yaml | Re-authored via 41 c3x set <id> codemap; c3x dropped 9 ref-* blocks; component blocks (lines 1-174) byte-identical to HEAD | diff of HEAD vs new lines 1-174 = IDENTICAL |
| Canonical seal | code-map.yaml now c3x-managed + sealed; ADR 20260518 reseal-normalized (c3-seal added) | c3x check → no ONLY_IN_TREE, no drift, no issues |
| Lookup resolution | c3x lookup resolves file→component+refs+rules again | c3x lookup src/server/agent.ts → c3-210 + 4 refs + 1 rule |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x check | Fails on seal drift / coverage regression | clean exit (issues: empty) after migration |
| c3x lookup <file> | Resolves file→component+refs (CLAUDE.md-mandated pre-edit step) | non-empty matches: for mapped files + globs |
| git diff .c3/code-map.yaml | Catches any unintended component-block change | only 9 ref-* key deletions, 0 additions |
| CI bun test | Guards no source regression (none expected; C3-metadata-only) | green run in worktree |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep hand-edited code-map.yaml, pin older c3x that tolerates it | Skill cache only ships 9.9.0; no older binary available; freezes the project on an unmaintained CLI |
| Accept c3x repair deleting code-map.yaml with no migration | Destroys the only file→component map; c3x lookup stays permanently broken; violates CLAUDE.md pre-edit mandate |
| Defer / document as known-broken | c3x lookup is mandated before every code edit; leaving it broken degrades every future change |
| Retain ref-* codemap blocks | Audit Phase 9 flags ref codemap as VIOLATION; c3x 9.9.0 drops them; refs already surface via component uses wiring |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Pattern transcription error (wrong glob on a component) | Patterns copied verbatim from git-HEAD code-map.yaml via scripted parse, no hand-typing | Component blocks (lines 1-174) byte-identical to HEAD; spot lookups per container |
| Component coverage regression vs legacy map | All 41 component keys re-set 1:1; none dropped | diff HEAD vs new lines 1-174 = IDENTICAL; c3x check clean |
| Ref governance lost by dropping ref-* codemap | Refs surface via component uses wiring instead | c3x lookup src/server/agent.ts returns c3-210 + 4 refs + 1 rule |
| Source code accidentally touched | Change is c3x set only (C3 store) | git diff --stat shows only .c3/ paths |

## Verification

| Check | Result |
| --- | --- |
| c3x check (in worktree) | clean: no ONLY_IN_TREE, no canonical drift, issues: empty |
| c3x lookup src/server/agent.ts | c3-210 + ref-colocated-bun-test, ref-event-sourcing, ref-provider-adapter, ref-tool-hydration + rule-colocated-bun-test |
| c3x lookup src/client/stores/**/*.ts | resolves to c3-102 |
| spot lookups (socket.ts, types.ts, uploads.ts, cloudflare-tunnel/gateway.ts) | c3-101 / c3-301 / c3-217 / c3-223 |
| diff HEAD vs new code-map.yaml lines 1-174 | IDENTICAL — zero component coverage regression |
| git diff --stat | only .c3/ paths changed (no src/) |
| bun test (in worktree) | passes (C3-metadata-only change; no source regression) |
