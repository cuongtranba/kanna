---
target: c3-233
scope: block
base: c3-233#n10763@v1:sha256:1920bd4791bc0e60018aa1c109ca22f40ab35b616c3946b467a897558d30fca4
---
Owns the server half of the `/cron` feature. `runCronCommand` dispatches
parsed commands (arm/list/remove/pause/resume, or a validation-error entry)
through `emitCronEvent` — the one write path: append event, scheduler.onEvent,
chat broadcast, global-topic push. `CronScheduler` (a deliberate sibling of
the one-shot ScheduleManager, sharing its injected Clock) re-arms after every
fire with 6-hour-chunked wall-clock-recomputed timeouts and, on rehydrate,
SKIPS fires missed while the server was down, reporting a visible
server_offline notice per job. `fireCronJob` runs inline fires (context
cleared before EVERY run — the arming chat is a monitoring view) and spawn
fires (a fresh chat per run in the arming chat's project, carded in the
arming chat); overlap is skip-and-record with an orphan self-heal, and
CONSECUTIVE skips collapse into one counted record (`CronSkipCoalescer`, a
per-job leading-edge throttle) so a sub-minute schedule's runs are not buried
under one card per skipped tick. Occurrence math delegates to the `cron` npm
package (CronTime.getNextDateFrom), including its 6-field seconds form.
Non-goals: turn orchestration (c3-210), the one-shot rate-limit resume
scheduler (c3-227), UI rendering (c3-120).
