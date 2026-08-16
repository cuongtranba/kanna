---
target: c3-227
scope: insert
base: c3-227#n10295@v1:sha256:c7e27b7d2a5cd4d96bd42ea33ab3f1d866bfe6f800d17a6b01d471461f3fbea0 "Armed-loop watch lifecycle"
---
| Cron events pass-through | OUT | cron_armed, cron_disarmed, cron_paused, cron_resumed, cron_run_started, cron_run_outcome, cron_run_skipped ride the same JSONL log (scheduleId doubles as cron job id); ScheduleManager holds no-op cases for them — recurring timers belong to the sibling CronScheduler | c3-233 | src/server/auto-continue/events.ts, src/server/auto-continue/schedule-manager.ts |
