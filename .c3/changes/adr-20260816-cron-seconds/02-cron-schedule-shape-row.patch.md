---
target: c3-311
scope: block
base: c3-311#n11232@v1:sha256:a33141f48d104961f378d8c6ff6c8442740255236d290742c593c35f367d5a50
---
| CronSchedule shape | OUT | Cron schedules carry the canonical 5- or 6-field expression (the occurrence engine's input) plus parsed CronFields for validation and humanize; the 6-field form's leading second lands on an OPTIONAL `second` field, so a job armed before sub-minute support replays from the durable log unchanged; intervals carry ms (down to 1000) and anchor at arm time | c3-233 | src/shared/cron/types.ts, src/shared/cron/parse-schedule.ts |
