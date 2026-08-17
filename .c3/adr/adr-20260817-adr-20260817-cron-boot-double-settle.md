---
id: adr-20260817-adr-20260817-cron-boot-double-settle
c3-seal: 6c81daa4b005ed8264aecca78041a15f1ac25b3de67994386ee5d031bb262dda
title: adr-20260817-cron-boot-double-settle
type: adr
goal: 'Fix three correlated defects in `cron-scheduler`''s boot reconciliation: (1) `reconcileCronRunsAtBoot` orphans a run whose tagged message survived in the durable queue, producing a double `cron_run_outcome` for the same `runId`; (2) `deriveCronJobs` blindly applies the second outcome, leaving the run with `status:"completed"` and `errorCode:"orphaned"` simultaneously; (3) the orphan scan reads the display-capped `recentRuns` list, silently missing running runs buried under many skip records.'
status: done
date: "2026-08-17"
---

## Goal

Fix three correlated defects in `cron-scheduler`'s boot reconciliation: (1) `reconcileCronRunsAtBoot` orphans a run whose tagged message survived in the durable queue, producing a double `cron_run_outcome` for the same `runId`; (2) `deriveCronJobs` blindly applies the second outcome, leaving the run with `status:"completed"` and `errorCode:"orphaned"` simultaneously; (3) the orphan scan reads the display-capped `recentRuns` list, silently missing running runs buried under many skip records.

## Context

Dequeue-on-commit (`adr-20260813-queued-message-dequeue-on-commit`) preserves a queued message until its turn is durably recorded. A cron run whose message was enqueued but whose turn never went active therefore SURVIVES a server restart. `reconcileCronRunsAtBoot` assumed no turn survives, so it orphaned every run with `status:"running"` unconditionally. `recoverQueuedMessages` then re-drained the same tagged message; when its turn completed, `recordCronTurnOutcome` emitted a second `cron_run_outcome` for the same `runId`. The `deriveCronJobs` reducer applied both, but `errorCode` is sticky (only set, never cleared), leaving the row in a corrupt `completed + orphaned` state. Separately, the scan used `job.recentRuns` (bounded by `MAX_RECENT_CRON_RUNS = 20`); sub-minute schedules write one coalesced skip record per streak, and a long-running job could be buried under 20+ such records, escaping the orphan pass entirely and wedging the overlap guard until the idle-chat self-heal.

## Decision

- `reconcileCronRunsAtBoot` checks `getQueuedMessages(runChatId)` before emitting `orphaned`; a run whose tagged message is still in the queue is skipped (left for `recoverQueuedMessages`).
- The orphan scan switches from `job.recentRuns` to `findRunningCronRuns(events, chatId)`, a new pure function that walks the full, unbounded event log.
- `deriveCronJobs`'s `cron_run_outcome` case adds a `run.status !== "running"` guard (first-terminal-wins), so a second outcome for an already-settled run is ignored.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | reconcileCronRunsAtBoot, findRunningCronRuns, and deriveCronJobs all live in this component; its Change Safety section misses the double-settle and capped-scan risks | c3-233#n10870@v1:sha256:a809e4964c497ae1e305200178f46892a76d8d4a735091d2c21c558538c3ef6b "Change Safety" | Update the "Missed outcome" row's Detection column; add two new Change Safety rows for the double-settle and corrupt-row risks |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/cron/fire.test.ts | 18 pass, 0 fail |
| bun test --conditions production src/server/cron/read-model.test.ts | 22 pass, 0 fail |
| bun run lint | 0 warnings |
| bun run typecheck | 0 errors |
