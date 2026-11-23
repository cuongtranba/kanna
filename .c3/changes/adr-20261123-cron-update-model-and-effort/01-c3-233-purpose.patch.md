---
target: c3-233
scope: block
base: c3-233#n14208@v1:sha256:9da5a0ec2081e17c4599e4287ac50a244773c362d7c15f413beebaff0aec1687
---
Owns the server half of the `/cron` feature. `runCronCommand` dispatches
parsed commands (arm/list/remove/pause/resume/update) through `emitCronEvent` — the
one write path: append event, scheduler.onEvent, chat broadcast, global-topic
push — and refuses every invalid line through the single `refuseCronCommand`
choke point, which cards the failure and offers it to the model together.
The `update` case reads the current job from `deriveCronJobs`, merges the
`CronJobPatch`, and emits ONE `cron_updated` event with the same `scheduleId`.
`cron_updated` edits the definition in place: the read model overwrites
instruction, mode, scheduleText and schedule, overwrites model and modelOptions
only when the event carries them (an event logged before they were updatable
replays without wiping an armed model), and keeps runs, armedAt and paused. A
patched modelOptions merges per provider into the stored one, so an effort
change keeps a stored context window. `cronJobPatchSchema` is strict, so a
`cron.update` patch with an unknown key is rejected instead of acknowledged as
a no-op. `fireCronJob` enqueues the job's model and modelOptions, forcing the
1M window when the model id carries the `[1m]` suffix, so an update is accepted while a run is in flight and that run still
settles; `findRunningCronRuns` and `compactCronRunEvents` ignore it, unlike a
re-arming `cron_armed`, which would orphan the live run. The scheduler mutates
the existing armed job's schedule and re-arms it unless paused, so the next
fire is re-timed at once and `runFire` re-arms the same object. The fire path
reads the job at fire time, so the change applies from the next tick. The `update_cron` MCP tool
wraps the update dispatch (schedule, mode, instruction, model, effort); a `cron.update` WS command exposes it from the UI.
`createCronRepair` is the repair offer: when the parser produced no suggestion of
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
that the cancel loop triggers through the `EventStore.subscribeTurnTerminal`
listener before the event log is truncated. `Lifetime` (`src/server/lifetime.ts`)
sequences it: `CronScheduler.shutdown()` is deferred in the quiesce phase, the
cancel loop, `drainCronOutcomes()` and the scheduler drain in the settle phase,
and the store's `flush()` followed by `snapshotAndTruncateLogs()` is the first
step deferred in teardown, so it runs last and no in-flight append races the
truncation.
Fires that outlive the drain deadline are abandoned and their runs are
reconciled as `orphaned` at next boot by `reconcileCronRunsAtBoot`.
Non-goals: turn orchestration (c3-210), the one-shot rate-limit resume
scheduler (c3-227), UI rendering (c3-120).