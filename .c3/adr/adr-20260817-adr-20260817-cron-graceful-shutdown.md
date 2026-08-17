---
id: adr-20260817-adr-20260817-cron-graceful-shutdown
c3-seal: 532cbe5131833f2d2cdce17b15b3b2ffafb3e75e5346771c9b82f716270a3af0
title: adr-20260817-cron-graceful-shutdown
type: adr
goal: Update c3-233 (cron-scheduler) to document the graceful-shutdown path added in fix/672. `CronScheduler.shutdown()` is now async, tracks in-flight fires, and drains them under a bounded timeout; `AgentCoordinator.drainCronOutcomes()` awaits cancel-triggered `cron_run_outcome` writes before log truncation; `EventStore.flush()` is called before `snapshotAndTruncateLogs()`.
status: done
date: "2026-08-17"
---

## Goal

Update c3-233 (cron-scheduler) to document the graceful-shutdown path added in fix/672. `CronScheduler.shutdown()` is now async, tracks in-flight fires, and drains them under a bounded timeout; `AgentCoordinator.drainCronOutcomes()` awaits cancel-triggered `cron_run_outcome` writes before log truncation; `EventStore.flush()` is called before `snapshotAndTruncateLogs()`.

## Context

The c3-233 Purpose section described only the boot half of restart handling with no mention of shutdown. The Change Safety table had no shutdown row. Issue #672 identified that in-flight fires were killed mid-write on SIGTERM, cancel outcomes were not awaited before log truncation, and the event log could be truncated before queued writes landed on disk.

## Decision

1. Add a paragraph to the Purpose section describing the shutdown quiesce: `stopped` flag, in-flight drain bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS`, cancel-outcome drain via `drainCronOutcomes()`, and `flush()`-before-truncate.
2. Add one Change Safety row for the shutdown path: risk that in-flight events are lost at truncation time, with its trigger, detection method, and required verification command.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | Purpose and Change Safety sections updated to cover graceful shutdown | c3-233#n10828@v1:sha256:ca6441e8cd8f78509251ebf6c38c28770d68643db6c819af8444faf0948d3da4 | ref-event-sourcing: flush-before-truncate satisfies the durability invariant |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | All cron mutations land as events; shutdown must flush in-flight appends before snapshotAndTruncateLogs or a run record is permanently lost | ref-event-sourcing#n11379@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | comply |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/cron/scheduler.test.ts | 11 pass, shutdown drain tests included |
| bun run test src/server/cron/skip-coalescer.test.ts | 12 pass, drop-behavior documentation test included |
| bun run test | full suite green |
| bun run lint && bun run typecheck | zero warnings, zero type errors |
