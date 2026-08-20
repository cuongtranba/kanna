---
id: adr-20260820-add-cron-update-subcommand
c3-seal: 2f55c53536f3ccef2b6fd568d718dde7064d03f71188cc77b69787ed57438500
title: add-cron-update-subcommand
type: adr
goal: |-
    Add `/cron update <jobId> <field> <value>` grammar to `parseCronCommand` and a
    `update_cron` MCP tool so users and the model can edit an armed cron job's
    schedule, mode, or instruction in place — without the racy arm-new-then-remove-old
    workaround.
status: done
date: "2026-08-20"
---

## Goal

Add `/cron update <jobId> <field> <value>` grammar to `parseCronCommand` and a
`update_cron` MCP tool so users and the model can edit an armed cron job's
schedule, mode, or instruction in place — without the racy arm-new-then-remove-old
workaround.

## Context

Before this change the only way to change a field on an armed cron job was to
arm a new job and remove the old one. That is racy (the old job can fire
between arm and remove) and produces unnecessary history in the transcript.
The `/cron` grammar had no update form; `confirm-report.ts` directed the model
to arm-and-remove; and the `cron_armed` event always set `paused: false`,
breaking update-in-place for paused jobs.

## Decision

Extend `parseCronCommand` with an `update` subcommand that modifies one field at
a time. Disambiguation from the arm form relies on the field-name token: `mode`
claims the line only when the line is exactly five tokens long (so the mode
value's position is fixed); `schedule` and `instruction` claim only when no mode
word appears after position 3. Unknown fields fall through to `parseArm`. The
`update` case in `runCronCommand` reads the current job from `deriveCronJobs`,
guards against an active run, merges the patch, and emits ONE `cron_armed` event
with the same `scheduleId` — the "re-arming replaces wholesale" read-model rule
handles idempotency. A new optional `paused?: boolean` field on `cron_armed`
preserves the paused state on update. The `update_cron` MCP tool wraps this
dispatch, and a `cron.update` WS command exposes it from the UI. The arm
confirmation prompt is updated to direct the model to `update_cron` instead of
arm-and-remove.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-311 | component | parseCronCommand gains update subcommand; CronJobPatch type and CronCommand union extended; confirm-report now names update_cron | c3-311#n11794@v1:sha256:6a406a06e4870c174397d1c452437f4dde4225e7f542f11f9bb110e8601287df "Owns everything about `/cron` that is pure and shared: `parseCronCommand`" | Purpose updated to document the update grammar and CronJobPatch |
| c3-233 | component | runCronCommand gains update case; cron_armed gains paused field; update_cron MCP tool and cron.update WS command added | c3-233#n11319@v1:sha256:87aa10e5888f4abbbebf2476b319cbcd260277726ced8403aa21268be4b54d3f "Owns the server half of the `/cron` feature. `runCronCommand` dispatches" | Purpose updated to list update dispatch and new tooling |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/cron/types.ts | Added CronJobPatch interface; CronCommand union extended with update variant | src/shared/cron/types.ts |
| src/shared/cron/parse-command.ts | parseUpdate / parseUpdateMode / parseUpdateFieldValue functions; dispatch in parseSubcommand | src/shared/cron/parse-command.ts |
| src/server/auto-continue/events.ts | cron_armed event gains optional paused field | src/server/auto-continue/events.ts |
| src/server/cron/commands.ts | update case in runCronCommand switch; hasActiveRun guard | src/server/cron/commands.ts |
| src/server/cron/read-model.ts | paused derivation changed from false to event.paused ?? false | src/server/cron/read-model.ts |
| src/server/cron/scheduler.ts | paused derivation changed; arm skipped for paused jobs on update | src/server/cron/scheduler.ts |
| src/server/kanna-mcp.ts | update_cron tool; updateCron arg wiring | src/server/kanna-mcp.ts |
| src/shared/protocol.ts | cron.update WS command type | src/shared/protocol.ts |
| src/server/ws-router-agent-ctrl.ts | cron.update case | src/server/ws-router-agent-ctrl.ts |
| src/shared/cron/confirm-report.ts | direct model to use update_cron instead of arm-and-remove | src/shared/cron/confirm-report.ts |
| src/shared/transcript-types.ts | CronJobChangeEntry.change union gains "updated" | src/shared/transcript-types.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/cron/parse-command.test.ts src/server/cron/commands.test.ts src/server/kanna-mcp.test.ts | 138 pass, 0 fail |
| bun run lint | exits 0 with --max-warnings=0 |
| node_modules/typescript-7/bin/tsc --noEmit | exits 0 |
