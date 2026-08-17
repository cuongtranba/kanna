---
target: c3-233
scope: insert
base: "c3-233#n10844@v1:sha256:ec698c99fa81957e2e61fa90d9ac9caa02f9efe94c3ee4a19d5264b8050e9397"
---
| In-flight cron event lost when log is truncated at shutdown | A new write path in fire.ts or server.ts that bypasses flush() before snapshotAndTruncateLogs(), or a cancel path that drops the drainCronOutcomes() await | scheduler.test.ts shutdown drain test asserts in-flight fire completes before shutdown returns; EventStore.flush() call in server.ts shutdown is the choke point | bun test src/server/cron/scheduler.test.ts |
