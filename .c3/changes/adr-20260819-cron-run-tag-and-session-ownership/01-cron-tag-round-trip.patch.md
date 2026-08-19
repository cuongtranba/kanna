---
target: c3-233
scope: insert
base: c3-233#n11129@v1:sha256:005c24fb870aa1eaab2114a690e3f47766155ee732a5ee4991ec9205857a2d4e
---
| Cron run never settles because its tag is lost before the turn starts | A queued-message write path that does not carry CronRunTag verbatim; the tag is the only link from a fired run to the turn that answers it, and onTurnTerminal reads it off the ActiveTurn | Absence of any cron_run_outcome ok:true while turn_finished events exist — every run then settles via fireCronJob's orphan self-heal or skips as previous_run_active. The cron fire suite fakes enqueueMessage and hand-preserves the tag, so it cannot detect this; the round-trip is pinned against the real EventStore | bun test src/server/event-store.test.ts src/server/event-store-write-ops.test.ts |
