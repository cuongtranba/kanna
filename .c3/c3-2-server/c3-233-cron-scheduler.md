---
id: c3-233
c3-seal: 9298c080983ada20fb0db6724808b54018687ab20eb49b2a8440ac55cc1892c7
title: cron-scheduler
type: component
category: feature
parent: c3-2
goal: |-
    Run armed cron jobs: dispatch `/cron` commands into durable events, keep
    recurring timers, fire inline and spawn runs with skip-and-record overlap
    semantics, attribute run outcomes, and project the per-chat and global cron
    read models.
uses:
    - ref-cqrs-read-models
    - ref-event-sourcing
    - rule-colocated-bun-test
    - rule-strong-typing
---

# cron-scheduler

## Goal

Run armed cron jobs: dispatch `/cron` commands into durable events, keep
recurring timers, fire inline and spawn runs with skip-and-record overlap
semantics, attribute run outcomes, and project the per-chat and global cron
read models.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "coordinate agent turns, persist events, broadcast derived read models" — the recurring-schedule layer above the send pipeline |
| Category | feature |
| Lifecycle | Long-lived CronScheduler holding per-job chunked timers; all durable state on the auto-continue event log |
| Replaceability | Replaceable while the cron_* event shapes, the skip-and-record overlap policy, and the CronJobSnapshot read-model contract are preserved |

## Purpose

Owns the server half of the `/cron` feature. `runCronCommand` dispatches
parsed commands (arm/list/remove/pause/resume) through `emitCronEvent` — the
one write path: append event, scheduler.onEvent, chat broadcast, global-topic
push — and refuses every invalid line through the single `refuseCronCommand`
choke point, which cards the failure and offers it to the model together.
`createCronRepair` is that offer: when the parser produced no suggestion of
its own it enqueues a repair prompt and drains the queue (`/cron` starts no
turn, so nothing else would), bounded to arm-shaped failures, one ask per
line per chat, standing aside for a queued user message, swallowing its own
failures, and disabled by `KANNA_CRON_REPAIR=disabled`. `createCronConfirm`
is the success-case sibling: after every successful typed `/cron` arm it
enqueues a `formatCronConfirmRequest` prompt and drains the queue so the
model presents the full `CronArmSummary` and calls `AskUserQuestion` —
options: Confirm / Change schedule / Change mode / Change instruction / Disarm
— bounded to one ask per jobId per chat, standing aside for a queued user
message, swallowing its own failures, and disabled by
`KANNA_CRON_CONFIRM=disabled`. Does not fire on `arm_cron` calls (that path
already confirms in-turn via the tool result). `previewCronCommand`
is the single answer behind the `validate_cron` / `arm_cron` MCP tools in
c3-226, so neither can contradict the other. `CronScheduler` (a deliberate
sibling of the one-shot ScheduleManager, sharing its injected Clock) re-arms
after every fire with 6-hour-chunked wall-clock-recomputed timeouts and, on
rehydrate, SKIPS fires missed while the server was down, reporting a visible
server_offline notice per job. `fireCronJob` runs inline fires (context
cleared before EVERY run — the arming chat is a monitoring view) and spawn
fires (a fresh chat per run in the arming chat's project, carded in the
arming chat); overlap is skip-and-record with an orphan self-heal, and
CONSECUTIVE skips collapse into one counted record (`CronSkipCoalescer`, a
per-job leading-edge throttle) so a sub-minute schedule's runs are not buried
under one card per skipped tick. Occurrence math delegates to the `cron` npm
package (CronTime.getNextDateFrom), including its 6-field seconds form.
`compactCronRunEvents` owns RETENTION for run events on c3-227's log, which
never expires on its own: measured on one install, cron run events were 96% of
every auto-continue event and 69% of the whole snapshot, resident in memory and
re-walked by deriveCronJobs on every broadcast. It keeps each job's newest
MAX_RECENT_CRON_RUNS settled runs plus every run still in flight, reclaims
everything before a job's most recent arm, and never touches a non-run event.
Retention is derived from the display cap rather than chosen, so the read model
provably cannot notice; both readers are asserted unchanged over a compacted
log. It is applied at the two places that build the array — applyAutoContinueToState
and the snapshot load — and is IRREVERSIBLE once the log is truncated.
Shutdown: `CronScheduler.shutdown()` is async — it sets a `stopped` flag
(so any timer callback that fires concurrently declines to start a new fire),
clears all timers, then drains every in-flight `runFire` call under
`SHUTDOWN_DRAIN_TIMEOUT_MS` (5 s, shorter than Docker's 10 s kill grace).
`AgentCoordinator.drainCronOutcomes()` awaits the `cron_run_outcome` writes
that the cancel loop triggers via `onTurnTerminal` before the event log is
truncated. `EventStore.flush()` is called immediately before
`snapshotAndTruncateLogs()` so no in-flight append races the truncation.
Fires that outlive the drain deadline are abandoned and their runs are
reconciled as `orphaned` at next boot by `reconcileCronRunsAtBoot`.
Non-goals: turn orchestration (c3-210), the one-shot rate-limit resume
scheduler (c3-227), UI rendering (c3-120).

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | All cron mutations land as events first; scheduler state is replayable from the log | must follow | rehydrate derives jobs via deriveCronJobs |
| ref-cqrs-read-models | ref | UI consumes CronJobSnapshot projections, never the event log directly | must follow | deriveCronJobs feeds ChatSnapshot.cronJobs + the cron-jobs topic |
| rule-strong-typing | rule | Event kinds, snapshots, and deps interfaces are fully typed | wired compliance target | typed at module boundary |
| rule-colocated-bun-test | rule | scheduler/fire/commands/read-model each sit next to their .test.ts | wired compliance target | FakeClock drives scheduler tests |
| adr-20260816-builtin-cron-jobs | adr | The whole component: grammar interception, node-cron adoption, outcome attribution, overlap policy | decision record | authored with this component |
| adr-20260816-cron-seconds | adr | Sub-minute schedules and the coalescing of consecutive skips into one counted record | decision record | seconds come from node-cron's own 6-field form; the count is tallied at the tick, never derived at read time |
| adr-20260818-cron-arm-confirmation | adr | Arm-first-then-confirm design and the createCronConfirm skip rules | decision record | typed /cron path only; arm_cron confirms in-turn |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Cron events | OUT | cron_armed/cron_disarmed/cron_paused/cron_resumed/cron_run_started/cron_run_outcome/cron_run_skipped on the auto-continue JSONL log; scheduleId doubles as job id | c3-227 | src/server/auto-continue/events.ts, src/server/cron/commands.ts |
| /cron dispatch | IN | runBuiltinCommand routes every parsed /cron message (valid or error) to runCronCommand; never starts a turn | c3-210 | src/server/claude-send-command.ts, src/server/cron/commands.ts |
| Fire | IN | CronScheduler fire callback invokes AgentCoordinator.fireCronJob(chatId, jobId); inline clears context then enqueues; spawn creates a chat then enqueues there; a skipped tick writes only what CronSkipCoalescer hands back, and both fire paths flush the pending streak before starting a run | c3-210 | src/server/cron/scheduler.ts, src/server/cron/fire.ts, src/server/cron/skip-coalescer.ts |
| Run outcome | IN | EventStore.onTurnTerminal (the single recordTurnFinished/Failed/Cancelled choke point) reports the tagged turn's outcome; recordCronTurnOutcome lands it on the arming chat | c3-206 | src/server/event-store.ts, src/server/cron/fire.ts |
| Cron read model | OUT | deriveCronJobs projects CronJobSnapshot[] onto ChatSnapshot.cronJobs; the cron-jobs WS topic aggregates every chat for the global page; cron.remove/pause/resume WS commands reuse the /cron dispatch | c3-207 | src/server/cron/read-model.ts, src/server/ws-router-envelope.ts, src/server/ws-router-agent-ctrl.ts |
| Refusal + model escalation | OUT | refuseCronCommand is the one path a /cron line is refused on: it appends the cron_command_error card carrying the typed line AND offers the error to createCronRepair, which enqueues a repair prompt and drains the queue only when the parser had no suggestion, for arm-shaped parts, once per line per chat, standing aside for a queued user message. A schedule that parses but never fires escalates too, on a reconstructed canonical line. KANNA_CRON_REPAIR=disabled turns it off | c3-226 | src/server/cron/commands.ts, src/server/cron/repair.ts |
| Success + model confirm escalation | OUT | After a typed /cron arm succeeds, createCronConfirm enqueues a formatCronConfirmRequest prompt and drains the queue so the model presents the full CronArmSummary and confirms via AskUserQuestion; bounded to one ask per jobId per chat, standing aside for a queued user message, swallowing its own failures. Does not fire for arm_cron calls. KANNA_CRON_CONFIRM=disabled turns it off | c3-226 | src/server/cron/confirm.ts, src/server/cron/commands.ts |
| Preview payload | OUT | previewCronCommand returns CronArmSummary (structured) on success; callers project to prose via formatCronArmSummary; both validate_cron and arm_cron derive from the same structured payload so they can never disagree about the job they describe | c3-311 | src/server/cron/preview.ts |
| Run-event retention | OUT | compactCronRunEvents bounds the cron run events on the auto-continue log to each job's newest MAX_RECENT_CRON_RUNS settled runs plus every unsettled start, dropping start/outcome pairs atomically and reclaiming everything before a job's most recent arm; applied at applyAutoContinueToState and at snapshot load, the only two places the per-chat array is built | c3-227 | src/server/cron/compact.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Missed outcome wedges the overlap guard into skipping forever | A turn finalize path that bypasses the onTurnTerminal observer | fireCronJob's orphan self-heal settles a running run whose chat is idle; reconcileCronRunsAtBoot checks getQueuedMessages before emitting orphaned and uses findRunningCronRuns (unbounded scan) instead of the display-capped recentRuns | bun test src/server/cron/fire.test.ts |
| Boot fires a storm of missed runs | Rehydrate replaying past fires instead of skipping | Scheduler rehydrate test asserts skip + future arm | bun test src/server/cron/scheduler.test.ts |
| Occurrence semantics drift from the engine | node-cron upgrade changing day-matching or strictly-after behavior | Behavioral next-fire table pins vixie OR, leap years, impossible-date null | bun test src/server/cron/next-fire.test.ts |
| A skip streak outlives the job it belongs to, or is never reported | A fire path that starts a run without flushing, or a lifecycle event that does not forget the streak | fire.test.ts asserts the tail lands before the run it waited on, and that a pause drops the folded count | bun test src/server/cron/fire.test.ts src/server/cron/skip-coalescer.test.ts |
| In-flight cron event lost when log is truncated at shutdown | A new write path in fire.ts or server.ts that bypasses flush() before snapshotAndTruncateLogs(), or a cancel path that drops the drainCronOutcomes() await | scheduler.test.ts shutdown drain test asserts in-flight fire completes before shutdown returns; EventStore.flush() call in server.ts shutdown is the choke point | bun test src/server/cron/scheduler.test.ts |
| Boot reconcile double-settles a queued run | reconcileCronRunsAtBoot orphans a run whose tagged message survived in the durable queue; recoverQueuedMessages then re-drains it and emits a second cron_run_outcome for the same runId | reconcileCronRunsAtBoot checks getQueuedMessages before emitting orphaned — a run with a surviving queued message is skipped | bun test src/server/cron/fire.test.ts |
| cron_run_outcome corrupt row from double-settle | two outcome events for the same runId; errorCode set by the orphaned event is never cleared when the success event lands | deriveCronJobs cron_run_outcome handler is first-terminal-wins — only settles a run still in running status, so a second outcome is ignored | bun test src/server/cron/read-model.test.ts |
| Cron run never settles because its tag is lost before the turn starts | A queued-message write path that does not carry CronRunTag verbatim; the tag is the only link from a fired run to the turn that answers it, and onTurnTerminal reads it off the ActiveTurn | Absence of any cron_run_outcome ok:true while turn_finished events exist — every run then settles via fireCronJob's orphan self-heal or skips as previous_run_active. The cron fire suite fakes enqueueMessage and hand-preserves the tag, so it cannot detect this; the round-trip is pinned against the real EventStore | bun test src/server/event-store.test.ts src/server/event-store-write-ops.test.ts |
| Retention drops a run the readers still need | compactCronRunEvents evicting an unsettled start (the overlap guard inverts and inline mode clears the context of a live turn), splitting a start/outcome pair (boot writes a bogus orphaned outcome every boot), or dropping the newest record (boot claims up to 100 missed fires) | compact.test.ts asserts deriveCronJobs and findRunningCronRuns are unchanged over a compacted log across nine log shapes, one case per invariant, and scheduler.test.ts asserts rehydrate reports the same missed count; retention is derived from MAX_RECENT_CRON_RUNS so it cannot be set below the display cap | bun test src/server/cron/compact.test.ts src/server/cron/scheduler.test.ts src/server/event-store.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/cron/scheduler.ts | Contract (Fire) | Timer chunk size | src/server/cron/scheduler.ts |
| src/server/cron/fire.ts | Contract (Fire + Run outcome) | Skip-entry wording | src/server/cron/fire.ts |
| src/server/cron/commands.ts | Contract (Cron events) | Entry wording | src/server/cron/commands.ts |
| src/server/cron/read-model.ts | Contract (Cron read model) | Bounded recentRuns cap | src/server/cron/read-model.ts |
| src/server/cron/next-fire.ts | Contract (Fire) | Engine call shape | src/server/cron/next-fire.ts |
| src/server/cron/skip-coalescer.ts | Contract (Fire) | Flush window length | src/server/cron/skip-coalescer.ts |
| src/server/cron/confirm.ts | Contract (Success + model confirm escalation) | Prompt wording | src/server/cron/confirm.ts |
| src/server/cron/compact.ts | Contract (Run-event retention) | Eviction bookkeeping | src/server/cron/compact.ts |
