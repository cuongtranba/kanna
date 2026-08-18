---
id: adr-20260818-adr-20260818-cron-armed-full-config
c3-seal: e834290059588f8b22a8c0afd5ca37f080f1b993166da1e435c341ebd743d182
title: adr-20260818-cron-armed-full-config
type: adr
goal: 'Extend `CronArmedMessage` to display the full job configuration at arm time: model, the next 3 upcoming fire times (server-computed), cwd for spawn mode, plus Edit (copy command to clipboard) and Disarm actions. Update c3-120''s Purpose to reflect the expanded card.'
status: done
date: "2026-08-18"
---

## Goal

Extend `CronArmedMessage` to display the full job configuration at arm time: model, the next 3 upcoming fire times (server-computed), cwd for spawn mode, plus Edit (copy command to clipboard) and Disarm actions. Update c3-120's Purpose to reflect the expanded card.

## Context

`CronArmedMessage` previously showed only job id, instruction, mode pill, humanized schedule, and the inline monitoring note. Users had no visibility into the model the job will use, the upcoming fire schedule beyond the first fire, or the spawn working directory. There was no in-card action to edit or disarm the job without typing another `/cron` subcommand.

The transcript type `CronArmedEntry` stored only `nextFireAt: number | null`; the model, upcoming fires beyond the first, and the cwd recorded at arm time were not persisted.

## Decision

Extend `CronArmedEntry` with three optional fields (`model`, `upcomingFires`, `cwd`) populated at arm time in `runCronCommand`. `CronArmedMessage` is rewritten to surface all of them using the same `CopyStateStore` pattern as `CronCommandErrorMessage`. Old entries without `upcomingFires` fall back to `nextFireAt` for backward compatibility.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-120 | component | Purpose section updated to reflect expanded CronArmedMessage fields (model, upcomingFires, cwd) and actions (Edit, Disarm) | c3-120#n9051@v1:sha256:a9fa40bf7d8199a86bd66c538050afaf8176971d89ccadabd20463ee14ccc134 | Updated Purpose reflects new server-computed fields and Edit/Disarm actions |

## Verification

| Check | Result |
| --- | --- |
| `bun run test src/client/components/messages/CronMessages.test.tsx` | All 17 CronArmedMessage cases pass (model, upcomingFires, nextFireAt fallback, cwd, Disarm, Edit) |
| `bun run test src/server/cron/commands.test.ts` | All 18 cases pass (model+upcomingFires 3 fires, cwd wired, cwd omitted) |
| `bun run lint` | 0 errors, 0 warnings |
| `bun run typecheck` | 0 errors |
