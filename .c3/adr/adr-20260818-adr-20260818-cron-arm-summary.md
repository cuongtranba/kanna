---
id: adr-20260818-adr-20260818-cron-arm-summary
c3-seal: 566324e2c7216a9cccda3762ee8d35ebe6762796354497fbbe27e41b3cdef3df
title: adr-20260818-cron-arm-summary
type: adr
goal: |-
    Extract `CronArmSummary` as the single structured payload describing one armed
    (or previewed) cron job, and make every prose description of a job a pure
    projection of that type. After this change `previewCronCommand` returns
    `CronArmSummary` and callers call `formatCronArmSummary` to get the text — no
    surface formats its own mode description string.
status: done
date: "2026-08-18"
---

## Goal

Extract `CronArmSummary` as the single structured payload describing one armed
(or previewed) cron job, and make every prose description of a job a pure
projection of that type. After this change `previewCronCommand` returns
`CronArmSummary` and callers call `formatCronArmSummary` to get the text — no
surface formats its own mode description string.

## Context

Four surfaces currently each write their own mode description: `preview.ts`
hardcodes `"runs in this chat, context cleared each cycle"` inline, `repair-report.ts`
has a second copy, `CronListMessage.tsx` has a third paraphrase, and
`CronArmedMessage.tsx` has a fourth. A React card cannot parse the
`summary: string` field of `CronPreview` to extract individual fields, and a
test cannot assert "the mode is inline" without string-matching prose. The
`previewCronCommand` function is already the shared oracle for both
`validate_cron` and `arm_cron`; extending it to return a structured type
completes that invariant one level up.

## Decision

Add `CronArmSummary` to `src/shared/cron/types.ts` and
`src/shared/cron/arm-summary.ts` (pure, shared, no IO):
`cronModeConsequence(mode)` is the single authoring site for the mode
description strings; `formatCronArmSummary(summary)` projects the struct to
prose byte-identically to the old hardcoded strings, pinned by a colocated
test. `previewCronCommand` returns `summary: CronArmSummary`; callers wrap with
`formatCronArmSummary` where they need text. `repair-report.ts` and
`CronListMessage.tsx` call `cronModeConsequence` instead of repeating the
literal string.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-311 | component | CronArmSummary and cronModeConsequence/formatCronArmSummary added to the shared pure cron domain; new files arm-summary.ts and arm-summary.test.ts | c3-311#n11328@v1:sha256:d11eab5adc870746db2bf531288dff6faba6ff376dbadb8b8d4d46a7eab23ad6 | Purpose and Contract updated; Derived Materials row added |
| c3-233 | component | previewCronCommand return type changes from string to CronArmSummary; callers updated | c3-233#n10862@v1:sha256:2477ebe06fb7d868ad917a936d83f7f091fbb0155be64d1bece73cef5c4f9951 | Contract row added for preview payload |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/cron/arm-summary.test.ts | 4 pass, 0 fail — formatCronArmSummary byte-identical to old prose |
| grep -rn "context cleared each cycle" src/ returns one production file | src/shared/cron/arm-summary.ts only |
| bun run test | 6479 pass, 0 fail |
| bun run lint | 0 warnings |
| bun run typecheck | clean |
