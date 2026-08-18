---
target: c3-233
scope: insert
base: c3-233#n10890@v1:sha256:bbc859adef0f44544a9e167929d27b6980720b431f83f02cb405dcc64d2e75e7
---
| Preview payload | OUT | previewCronCommand returns CronArmSummary (structured) on success; callers project to prose via formatCronArmSummary; both validate_cron and arm_cron derive from the same structured payload so they can never disagree about the job they describe | c3-311 | src/server/cron/preview.ts |
