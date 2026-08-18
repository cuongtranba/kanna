---
target: c3-311
scope: block
base: c3-311#n11338@v1:sha256:d2128de9b1f9a73ef67ad4a4564d3fe85ca26d107eadc4b8341ac902e88fd4b4
---
Owns everything about `/cron` that is pure and shared: `parseCronCommand`
(the arm grammar anchors on the LAST inline/spawn token so instructions need
no quoting; every failure names the failing part, records the offending line,
and, when unambiguous, carries a complete corrected line that is
drift-guard-tested to re-parse), `parseSchedule` (cron with 5 fields or 6
with a LEADING second — node-cron's own sub-minute shape — with per-field
range diagnostics, @shortcut expansion, validated wildcard padding for a
short cron, and `every Ns|Nm|Nh` intervals kept anchor-based rather than
rewritten to cron fields; there is no minimum cadence, because a cadence is
chosen in the `/cron` line and nowhere else), `humanizeSchedule` (which reads
a sub-minute cadence in seconds rather than fractional minutes),
`formatCronDefect` / `formatCronRepairRequest`
(the words both the validate_cron tool result and the model repair prompt
speak, so the model is never taught two vocabularies for one defect),
`CronArmSummary` / `cronModeConsequence` / `formatCronArmSummary`
(`cronModeConsequence` is the SINGLE authoring site for the mode description
strings; `formatCronArmSummary` projects a structured `CronArmSummary` to
prose byte-identically, so all surfaces that describe an armed job derive from
one type and can never disagree), and the `CronJobSnapshot` / `CronRunSnapshot`
/ `CronRunTag` / `CronJobsGlobalSnapshot` types. Non-goals:
next-occurrence computation (server-only, delegated to the `cron` npm package
in c3-233 so luxon stays out of the client bundle), timers, event persistence,
and any IO — the side-effect seal holds this module pure.
