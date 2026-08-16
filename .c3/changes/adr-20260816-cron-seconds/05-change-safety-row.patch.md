---
target: c3-233
scope: insert
base: c3-233#n10785@v1:sha256:bfd114c029ec41117b3ad589b7ca138e0adfe46558755880360d786bdb63e4f4
---
| A skip streak outlives the job it belongs to, or is never reported | A fire path that starts a run without flushing, or a lifecycle event that does not forget the streak | fire.test.ts asserts the tail lands before the run it waited on, and that a pause drops the folded count | bun test src/server/cron/fire.test.ts src/server/cron/skip-coalescer.test.ts |
