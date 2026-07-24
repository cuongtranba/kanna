---
id: adr-20260724-orch-bounded-diff-structured-review
c3-seal: 70c37dc12dafd638473edf1220837c5cd063a17a45ff0da120276670c7d89abd
title: orch-bounded-diff-structured-review
type: adr
goal: 'Harden the orchestration phase pipeline against two context-quality failure modes: (1) the `{{DIFF}}` template var was injected into review-phase prompts unbounded — one large implement phase (lockfiles, generated code) could blow the review workers'' context window; (2) adversarial-review output was free text joined with `---`, so overlapping findings from the two parallel reviewers were duplicated into the fix phase and no structure carried across the hand-off. This ADR adds a pure diff-bounding module and a structured (typed, deduped) review-findings pipeline.'
status: accepted
date: "2026-07-24"
---

## Goal

Harden the orchestration phase pipeline against two context-quality failure modes: (1) the `{{DIFF}}` template var was injected into review-phase prompts unbounded — one large implement phase (lockfiles, generated code) could blow the review workers' context window; (2) adversarial-review output was free text joined with `---`, so overlapping findings from the two parallel reviewers were duplicated into the fix phase and no structure carried across the hand-off. This ADR adds a pure diff-bounding module and a structured (typed, deduped) review-findings pipeline.

## Context

`OrchestrationQueue.composePrompt` (c3-232) resolved `{{DIFF}}` by injecting `diffAgainstBase` output verbatim; only `{{PRIOR}}` was capped (MAX_PHASE_OUTPUT_CHARS = 64k). The DEFAULT_ORCH_PHASES review template asked for free-text "file:line + problem + suggested fix" replies, and the queue joined the two parallel reviewers' outputs with `\n\n---\n\n` regardless of overlap. Research grounding (2026-07 deep-research pass): production multi-agent pipelines measure 29–38% redundant context tokens between agents (arXiv 2510.26585), and typed hand-off payloads are the state-of-the-art mitigation. Both changes are engine-internal — no event-store shape change, no WS/UI change, no new IO.

## Decision

Two pure server modules, wired into the existing pipeline at exactly two call sites:

1. `src/server/orchestration-diff.ts` — `boundDiff(diff, budget = MAX_DIFF_CHARS 64k)`. Under budget: verbatim. Over budget: a banner lists every changed file with +/- counts and omitted markers, then whole file segments are packed greedily IN ORDER (skipping any segment that no longer fits, so a giant early lockfile cannot starve later source files); if nothing fits whole, the first segment is included truncated. The banner points reviewers at `git diff <base>` in their worktree cwd. Wired in `composePrompt` at the `{{DIFF}}` replacement.
2. `src/server/orchestration-review.ts` — `parseReviewFindings` (tolerant: fenced ```json block, bare JSON array, NO_FINDINGS marker; anything else = unparsed), `dedupeFindings` (same file+line collapse, or same file + normalized-equal problem when both lines are null; higher severity survives, then the row carrying a suggestedFix), `renderFindings` (compact numbered block), `combineReviewOutputs` (all replies conformant → merged/deduped/rendered; ANY reply unparsed → raw join fallback so reviewer signal is never lost to format drift). Wired in `runTask` where review-kind phase outputs become `{{PRIOR}}`. The `OrchReviewFinding` interface + `OrchReviewSeverity` union live in `src/shared/orchestration-types.ts`; the DEFAULT_ORCH_PHASES review template now demands the fenced JSON shape (NO_FINDINGS unchanged).

Tolerant-parse-with-fallback was chosen over schema-enforced worker output because orchestration workers are plain subagent spawns with no StructuredOutput channel — a hard parse failure would fail real runs on cosmetic drift.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-232 | component | Owns the two new pure modules + both wiring call sites in orchestration-queue.ts; Purpose and Business Flow rows updated by this unit | c3-232#n8030@v1:sha256:0b2cbdbc212ca695157a303ca25aef215c204a6ae141fc930b950fe7720d26a3 "Owns: src/server/orchestration-queue.ts (OrchestrationQueue class)" | ref-strong-typing: no any/unknown escape — AnyValue + isRecord guard at the JSON.parse boundary; ref-colocated-bun-test: both modules have colocated tests |
| c3-3 | container | src/shared/orchestration-types.ts gains OrchReviewFinding + OrchReviewSeverity (pure types) and the updated review prompt template — no new module, no membership change | c3-3#n8092@v1:sha256:2107f72aa7565ecb55bb100cbf1631031db7b5b7c1dc21b068489f347844ccb9 "Define domain types (projects, chats, turns, transcript entries, provider catalog)." | Parent-fit unchanged; pure types remain in the thin shared seam |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Diff bounding | New pure module with MAX_DIFF_CHARS, order-preserving greedy packing, omitted markers, truncated-single-segment path | src/server/orchestration-diff.ts + src/server/orchestration-diff.test.ts (6 cases) |
| Structured review | New pure module: parse/dedupe/render/combine with raw-join fallback | src/server/orchestration-review.ts + src/server/orchestration-review.test.ts (15 cases) |
| Shared types | OrchReviewFinding, OrchReviewSeverity; review template rewritten to demand fenced JSON | src/shared/orchestration-types.ts |
| Queue wiring | boundDiff at the {{DIFF}} site; combineReviewOutputs for review-kind phase outputs | src/server/orchestration-queue.ts (composePrompt + runTask) |
| Integration tests | Structured findings reach the fix prompt deduped; oversized diff arrives bounded at review workers | src/server/orchestration-queue.test.ts (2 new cases) |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test --conditions production | 23 new test cases across the three suites; full suite green | 4390 pass / 0 fail |
| bun run typecheck | TS7 catches OrchReviewFinding shape drift at both producer and consumer | exit 0 |
| bun run lint | Side-effect seal (both modules pure), no-unknown/no-assertion gates | exit 0, 0 warnings |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hard-fail the run when a reviewer reply does not parse | Orchestration workers are plain subagent spawns with no schema-enforced output channel; cosmetic format drift would fail real runs — fallback-to-raw keeps the pipeline robust while structured replies get the dedupe upgrade |
| Truncate the diff with a blind head-slice | A lockfile or generated file at the top of the diff would consume the whole budget and hide every real source change; per-file packing with order-preserving skip keeps reviewable content in |
| Persist OrchReviewFinding[] in a new orchestration event variant | Event-store migration for a prompt-composition concern; the rendered string rides the existing orch_phase_completed.output field unchanged |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/orchestration-diff.test.ts src/server/orchestration-review.test.ts src/server/orchestration-queue.test.ts | 56 pass / 0 fail |
| bun run test (full suite) | 4390 pass / 2 skip / 0 fail |
| bun run typecheck | exit 0 |
| bun run lint | exit 0, --max-warnings=0 |
| bunx ast-grep test | 12 passed / 0 failed |
