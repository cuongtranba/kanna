---
target: c3-233
scope: block
base: "c3-233#n10819@v1:sha256:7347e7b0096e3cdd84728204ce3e95fd4d4b02a7a2822fa602260482110706e9"
---
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
arming chat); overlap is skip-and-record with an orphan self-heal, and
CONSECUTIVE skips collapse into one counted record (`CronSkipCoalescer`, a
per-job leading-edge throttle) so a sub-minute schedule's runs are not buried
under one card per skipped tick. Occurrence math delegates to the `cron` npm
package (CronTime.getNextDateFrom), including its 6-field seconds form.
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
