---
target: c3-311
scope: block
base: "c3-311#n11794@v1:sha256:bd18c5d4d8d3eb4041800bedb450a3e555839e8ee190384bbe7a6f93de1751b6"
---
Owns everything about `/cron` that is pure and shared: `parseCronCommand`
(the arm grammar anchors on the LAST inline/spawn token so instructions need
no quoting; every failure names the failing part, records the offending line,
and, when unambiguous, carries a complete corrected line that is
drift-guard-tested to re-parse; the `update` subcommand is disambiguated from
arm by the field-name token — `mode` claims only when the line is exactly five
tokens long, `schedule`/`instruction` claim only when no mode word follows
position 3, and unknown field tokens fall through to `parseArm`; `CronJobPatch`
is the typed partial that carries only the mutated field), `parseSchedule` (cron with 5 fields or 6
with a LEADING second — node-cron's own sub-minute shape — with per-field
range diagnostics, @shortcut expansion, validated wildcard padding for a
short cron, and `every Ns|Nm|Nh` intervals kept anchor-based rather than
rewritten to cron fields; there is no minimum cadence, because a cadence is
chosen in the `/cron` line and nowhere else), `humanizeSchedule` (which reads
a sub-minute cadence in seconds rather than fractional minutes),
`formatCronDefect` / `formatCronRepairRequest`
(the words both the validate_cron tool result and the model repair prompt
speak, so the model is never taught two vocabularies for one defect),
`formatCronConfirmRequest` (the confirm prompt the model receives after a
successful typed arm, derived from `formatCronArmSummary` so every review
surface shares one vocabulary; directs the model to call `update_cron` for
field changes rather than arm-and-remove),
`CronArmSummary` / `cronModeConsequence` / `formatCronArmSummary`
(`cronModeConsequence` is the SINGLE authoring site for the mode description
strings; `formatCronArmSummary` projects a structured `CronArmSummary` to
prose byte-identically, so all surfaces that describe an armed job derive from
one type and can never disagree), and the `CronJobSnapshot` / `CronRunSnapshot`
/ `CronRunTag` / `CronJobsGlobalSnapshot` types. Non-goals:
next-occurrence computation (server-only, delegated to the `cron` npm package
in c3-233 so luxon stays out of the client bundle), timers, event persistence,
and any IO — the side-effect seal holds this module pure.
