---
id: adr-20261110-cron-update-in-place-while-running
c3-seal: 860b9a5bb510377fed524b40d10beeda4aa2b9e63a398fec41b1a36f99d60cd2
title: cron-update-in-place-while-running
type: adr
goal: Let a user (and the model's update_cron tool) edit an armed cron job's instruction, mode or schedule while one of its runs is in flight, with the change applying from the next fire instead of being refused.
status: proposed
date: "2026-11-10"
---

## Goal

Let a user (and the model's update_cron tool) edit an armed cron job's instruction, mode or schedule while one of its runs is in flight, with the change applying from the next fire instead of being refused.

## Context

adr-20260820-add-cron-update-subcommand implemented `/cron update` by re-emitting `cron_armed` with the same scheduleId. Re-arming replaces the job wholesale: the read model drops its runs and resets armedAt, findRunningCronRuns forgets running runs, and compactCronRunEvents reclaims run records before a cron_armed. Re-arming mid-run would orphan the live run and flip hasActiveRun, so runCronCommand refused updates while a run was in flight and the client greyed out the Edit button. Users want to see and edit the job during a run.

## Decision

Add a `cron_updated` automation event that edits the job definition in place: it carries the full new instruction, mode, scheduleText and schedule, and the read model overwrites only those fields, keeping runs, armedAt, paused and model. runCronCommand's update case drops the hasActiveRun refusal and emits cron_updated. CronScheduler mutates the existing armed job's schedule and re-arms it unless paused, so the next fire is re-timed immediately and runFire re-arms the same object (never a second timer). fireCronJob already reads the job at fire time, so the in-flight run keeps the instruction it was enqueued with and the next tick uses the new one. A separate event was chosen over a flag on cron_armed because compaction, findRunningCronRuns and the read model all treat cron_armed as a reset, and keeping that meaning single avoids changing three retention invariants. The client keeps Edit available during a run and says the change applies from the next run.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | update emits cron_updated; read model and scheduler handle it; update_cron description | c3-233#n13899@v1:sha256:9da5a0ec2081e17c4599e4287ac50a244773c362d7c15f413beebaff0aec1687 "Owns the server half of the `/cron` feature. `runCronCommand` dispatches" | Purpose rewritten for the in-place update; event contract row lists cron_updated |
| c3-227 | component | cron_updated rides the auto-continue JSONL log as a pass-through cron event | c3-227#n13495@v1:sha256:20b95e60b18b85a4b6ce1d784e7c202c4959eb43487c80f747dde7893f41165f "Owns the Kanna auto-continue feature: classifies a turn-ending `result`" | Cron events pass-through row lists cron_updated |
| c3-120 | component | CronJobRow keeps Edit enabled during a run; edit dialog copy states changes apply from the next run | c3-120#n11823@v1:sha256:e117e2b6518b7c46d0350680ff8371c2a33b6075fb5149aeff5440b5e523a469 "Owns every cron surface the user sees. Transcript cards: CronArmedMessage" | N.A - no contract row names the old guard |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/cron src/client/app/CronJobsSection.test.tsx src/client/app/CronJobEditDialog.test.tsx | update during an active run keeps the run and applies the new instruction; scheduler re-times to the new interval |
| bun run check | exits 0 |
