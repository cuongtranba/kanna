---
target: c3-311
scope: block
base: c3-311#n11171@v1:sha256:d66739d6550868c0459462e9872b49ef3502f865dad8d386665316784eaee953
---
Owns everything about `/cron` that is pure and shared: `parseCronCommand`
(the arm grammar anchors on the LAST inline/spawn token so instructions need
no quoting; every failure names the failing part, records the offending line,
and, when unambiguous, carries a complete corrected line that is
drift-guard-tested to re-parse), `parseSchedule` (5-field cron with per-field
range diagnostics, @shortcut expansion, validated wildcard padding for a
short cron, `every Nm|Nh` intervals kept anchor-based rather than rewritten to
cron fields), `humanizeSchedule`, `formatCronDefect` / `formatCronRepairRequest`
(the words both the validate_cron tool result and the model repair prompt
speak, so the model is never taught two vocabularies for one defect), and the
`CronJobSnapshot` / `CronRunSnapshot` / `CronRunTag` / `CronJobsGlobalSnapshot`
types. Non-goals: next-occurrence computation (server-only, delegated to the
`cron` npm package in c3-233 so luxon stays out of the client bundle), timers,
event persistence, and any IO — the side-effect seal holds this module pure.
