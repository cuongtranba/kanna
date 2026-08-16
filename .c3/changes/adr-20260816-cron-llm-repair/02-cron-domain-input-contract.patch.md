---
target: c3-311
scope: insert
base: c3-311#n11233@v1:sha256:9f51d5853829f8cda1f3f7957c3be5fc9e8c44f5ca7ebf51336f3b9e58612857
---
| Offending line recorded | OUT | Every CronParseError carries the trimmed line it rejected, and its `suggestion` being absent is the signal c3-233 escalates on. parseCronCommand stamps the line once over an internal Outcome type whose error omits it, so a failure path cannot record a defect without its line — `/cron` starts no turn, so nothing else in the transcript does | c3-233 | src/shared/cron/parse-command.ts, src/shared/cron/types.ts |
