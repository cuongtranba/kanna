---
id: c3-311
c3-seal: c29231806559212b3264e645af013859094e0bb7a32eacf19de9aca4f6b5be33
title: cron-domain
type: component
category: feature
parent: c3-3
goal: |-
    Own the pure `/cron` command domain: grammar parsing with field-level
    validation errors and re-parse-guaranteed corrected suggestions, schedule
    parsing (5-field cron, @shortcuts, every-interval sugar), schedule
    humanization, and the snapshot/tag types both client and server consume.
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
---

# cron-domain

## Goal

Own the pure `/cron` command domain: grammar parsing with field-level
validation errors and re-parse-guaranteed corrected suggestions, schedule
parsing (5-field cron, @shortcuts, every-interval sugar), schedule
humanization, and the snapshot/tag types both client and server consume.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "types both client and server import" — the cron feature's wire types plus the parser the send pipeline and the composer picker share |
| Category | feature |
| Lifecycle | Pure functions and types; no process state |
| Replaceability | Replaceable while the CronCommand/CronSchedule/CronJobSnapshot shapes and the always-intercept parse contract are preserved |

## Purpose

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
speak, so the model is never taught two vocabularies for one defect), and the
`CronJobSnapshot` / `CronRunSnapshot` / `CronRunTag` / `CronJobsGlobalSnapshot`
types. Non-goals: next-occurrence computation (server-only, delegated to the
`cron` npm package in c3-233 so luxon stays out of the client bundle), timers,
event persistence, and any IO — the side-effect seal holds this module pure.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-strong-typing | rule | CronCommand/CronSchedule/CronParseError are discriminated unions crossing the WS + event-log boundary | wired compliance target | no any/unknown on parse results |
| rule-colocated-bun-test | rule | Parser, schedule, humanizer modules each sit next to their .test.ts | wired compliance target | suggestion drift guard lives here |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| /cron interception | OUT | parseCronCommand returns null for non-/cron text and ALWAYS a result (ok or structured error) for any line whose first token is /cron — an invalid arm line never falls through as prompt text | c3-301 | src/shared/cron/parse-command.ts |
| Suggestion re-parse guarantee | OUT | Every CronParseError.suggestion is a complete /cron line validated to re-parse cleanly before it is attached | c3-1 | src/shared/cron/parse-command.ts, src/shared/cron/parse-command.test.ts |
| CronSchedule shape | OUT | Cron schedules carry the canonical 5- or 6-field expression (the occurrence engine's input) plus parsed CronFields for validation and humanize; the 6-field form's leading second lands on an OPTIONAL second field, so a job armed before sub-minute support replays from the durable log unchanged; intervals carry ms (down to 1000) and anchor at arm time | c3-233 | src/shared/cron/types.ts, src/shared/cron/parse-schedule.ts |
| Snapshot types | OUT | CronJobSnapshot/CronRunSnapshot/CronJobsGlobalSnapshot are the server-to-client cron read-model shapes on ChatSnapshot.cronJobs and the cron-jobs topic | c3-207 | src/shared/cron/types.ts |
| Offending line recorded | OUT | Every CronParseError carries the trimmed line it rejected, and its suggestion being absent is the signal c3-233 escalates on. parseCronCommand stamps the line once over an internal Outcome type whose error omits it, so a failure path cannot record a defect without its line — /cron starts no turn, so nothing else in the transcript does | c3-233 | src/shared/cron/parse-command.ts, src/shared/cron/types.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/cron/parse-command.ts | Contract (interception + suggestion guarantee) | Heuristic detail for near-miss recovery | src/shared/cron/parse-command.ts |
| src/shared/cron/parse-schedule.ts | Contract (CronSchedule shape) | Error message wording | src/shared/cron/parse-schedule.ts |
| src/shared/cron/humanize.ts | Contract (snapshot types) | Pattern coverage; falls back to raw schedule text | src/shared/cron/humanize.ts |
| src/shared/cron/parse-command.test.ts | Contract (suggestion re-parse guarantee) | Fixture selection | src/shared/cron/parse-command.test.ts |
| src/shared/cron/repair-report.ts | Contract (offending line recorded) | Prompt wording, so long as it names both cron tools and the ask-when-ambiguous rule | src/shared/cron/repair-report.ts, src/shared/cron/repair-report.test.ts |
