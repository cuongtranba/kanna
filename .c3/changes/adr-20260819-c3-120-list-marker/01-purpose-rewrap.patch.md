---
target: c3-120
scope: block
base: c3-120#n9360@v1:sha256:058e431c4561f3d3e1bb4899feb81a7377f473399126972815ab67dfcb3df05d
---
Owns every cron surface the user sees. Transcript cards: CronArmedMessage
(full arming record: instruction, mode, model, server-computed upcomingFires —
up to 3 upcoming timestamps in tabular-nums; falls back to nextFireAt for older
entries; cwd for spawn mode; Edit copies the reconstructed /cron command to the
clipboard; Disarm issues cron.remove), CronCommandErrorMessage (field-level
error + the ready-to-send corrected command behind the sanctioned
CopyStateStore + clipboard adapter), CronRunMessage (spawn-mode run card whose
LIVE status pill joins ChatSnapshot.cronJobs by runId — the entry itself stays
immutable), CronRunSkippedMessage and CronJobChangeMessage one-liners, and
CronListMessage (renders the CURRENT job list, not a frozen copy).
CronJobsSection is the live footer panel (humanized schedule, mode, next-fire
countdown in tabular-nums, last-run status, controls issuing
cron.pause/resume/remove WS commands). CronJobsPage at /cron consumes the
global cron-jobs topic through cronJobsStore (stable EMPTY ref), grouped by
project with chat links; a sidebar nav entry reaches it. Non-goals: any cron
domain logic (c3-311) or scheduling (c3-233); the client never computes
occurrences — it renders server-computed upcomingFires (3 upcoming timestamps
per arm; falls back to nextFireAt for older entries).
