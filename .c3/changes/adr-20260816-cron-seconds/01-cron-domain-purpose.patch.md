---
target: c3-311
scope: block
base: c3-311#n11221@v1:sha256:d66739d6550868c0459462e9872b49ef3502f865dad8d386665316784eaee953
---
Owns everything about `/cron` that is pure and shared: `parseCronCommand`
(the arm grammar anchors on the LAST inline/spawn token so instructions need
no quoting; every failure names the failing part and, when unambiguous,
carries a complete corrected line that is drift-guard-tested to re-parse),
`parseSchedule` (cron with 5 fields or 6 with a LEADING second — node-cron's
own sub-minute shape — with per-field range diagnostics, @shortcut expansion,
and `every Ns|Nm|Nh` intervals kept anchor-based rather than rewritten to cron
fields), `humanizeSchedule` (which reads a sub-minute cadence in seconds
rather than fractional minutes), and the `CronJobSnapshot` /
`CronRunSnapshot` / `CronRunTag` / `CronJobsGlobalSnapshot` types. There is no
minimum cadence: `every 1s` parses, because a cadence is chosen in the `/cron`
line and nowhere else. Non-goals: next-occurrence computation (server-only,
delegated to the `cron` npm package in c3-233 so luxon stays out of the client
bundle), timers, event persistence, and any IO — the side-effect seal holds
this module pure.
