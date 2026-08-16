---
id: c3-233
c3-seal: 0d8c0f7fd7af220f21604986bb5194157434f84961cb0982378e56084a8f2918
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
failures, and disabled by `KANNA_CRON_REPAIR=disabled`. `previewCronCommand`
is the single answer behind the `validate_cron` / `arm_cron` MCP tools in
c3-226, so neither can contradict the other. `CronScheduler` (a deliberate
sibling of the one-shot ScheduleManager, sharing its injected Clock) re-arms
after every fire with 6-hour-chunked wall-clock-recomputed timeouts and, on
rehydrate, SKIPS fires missed while the server was down, reporting a visible
server_offline notice per job. `fireCronJob` runs inline fires (context
cleared before EVERY run — the arming chat is a monitoring view) and spawn
fires (a fresh chat per run in the arming chat's project, carded in the
arming chat); overlap is skip-and-record with an orphan self-heal. Occurrence
math delegates to the `cron` npm package (CronTime.getNextDateFrom).
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

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Cron events | OUT | cron_armed/cron_disarmed/cron_paused/cron_resumed/cron_run_started/cron_run_outcome/cron_run_skipped on the auto-continue JSONL log; scheduleId doubles as job id | c3-227 | src/server/auto-continue/events.ts, src/server/cron/commands.ts |
| /cron dispatch | IN | runBuiltinCommand routes every parsed /cron message (valid or error) to runCronCommand; never starts a turn | c3-210 | src/server/claude-send-command.ts, src/server/cron/commands.ts |
| Fire | IN | CronScheduler fire callback invokes AgentCoordinator.fireCronJob(chatId, jobId); inline clears context then enqueues; spawn creates a chat then enqueues there | c3-210 | src/server/cron/scheduler.ts, src/server/cron/fire.ts |
| Run outcome | IN | EventStore.onTurnTerminal (the single recordTurnFinished/Failed/Cancelled choke point) reports the tagged turn's outcome; recordCronTurnOutcome lands it on the arming chat | c3-206 | src/server/event-store.ts, src/server/cron/fire.ts |
| Cron read model | OUT | deriveCronJobs projects CronJobSnapshot[] onto ChatSnapshot.cronJobs; the cron-jobs WS topic aggregates every chat for the global page; cron.remove/pause/resume WS commands reuse the /cron dispatch | c3-207 | src/server/cron/read-model.ts, src/server/ws-router-envelope.ts, src/server/ws-router-agent-ctrl.ts |
| Refusal + model escalation | OUT | refuseCronCommand is the one path a /cron line is refused on: it appends the cron_command_error card carrying the typed line AND offers the error to createCronRepair, which enqueues a repair prompt and drains the queue only when the parser had no suggestion, for arm-shaped parts, once per line per chat, standing aside for a queued user message. A schedule that parses but never fires escalates too, on a reconstructed canonical line. KANNA_CRON_REPAIR=disabled turns it off | c3-226 | src/server/cron/commands.ts, src/server/cron/repair.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Missed outcome wedges the overlap guard into skipping forever | A turn finalize path that bypasses the onTurnTerminal observer | fireCronJob's orphan self-heal settles a running run whose chat is idle | bun test src/server/cron/fire.test.ts |
| Boot fires a storm of missed runs | Rehydrate replaying past fires instead of skipping | Scheduler rehydrate test asserts skip + future arm | bun test src/server/cron/scheduler.test.ts |
| Occurrence semantics drift from the engine | node-cron upgrade changing day-matching or strictly-after behavior | Behavioral next-fire table pins vixie OR, leap years, impossible-date null | bun test src/server/cron/next-fire.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/cron/scheduler.ts | Contract (Fire) | Timer chunk size | src/server/cron/scheduler.ts |
| src/server/cron/fire.ts | Contract (Fire + Run outcome) | Skip-entry wording | src/server/cron/fire.ts |
| src/server/cron/commands.ts | Contract (Cron events) | Entry wording | src/server/cron/commands.ts |
| src/server/cron/read-model.ts | Contract (Cron read model) | Bounded recentRuns cap | src/server/cron/read-model.ts |
| src/server/cron/next-fire.ts | Contract (Fire) | Engine call shape | src/server/cron/next-fire.ts |
