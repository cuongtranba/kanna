---
target: c3-233
scope: insert
base: c3-233#n11817@v1:sha256:fea4bb2ee4af3d1e8f4c8abd344f242e09d50c01f410a27ba4bea684403e6912
---
| cron_run_outcome corrupt row from double-settle | two outcome events for the same runId; errorCode set by the orphaned event is never cleared when the success event lands | deriveCronJobs cron_run_outcome handler is first-terminal-wins — only settles a run still in running status, so a second outcome is ignored | bun test src/server/cron/read-model.test.ts |
