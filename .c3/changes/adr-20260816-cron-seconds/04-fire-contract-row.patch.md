---
target: c3-233
scope: block
base: c3-233#n10777@v1:sha256:bb129715bceacc1ea5d64ed3085f64adaed570c5c507192341256ce03c07bb78
---
| Fire | IN | CronScheduler fire callback invokes AgentCoordinator.fireCronJob(chatId, jobId); inline clears context then enqueues; spawn creates a chat then enqueues there; a skipped tick writes only what CronSkipCoalescer hands back, and both fire paths flush the pending streak before starting a run | c3-210 | src/server/cron/scheduler.ts, src/server/cron/fire.ts, src/server/cron/skip-coalescer.ts |
