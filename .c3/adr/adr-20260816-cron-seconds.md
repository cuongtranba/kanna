---
id: adr-20260816-cron-seconds
c3-seal: 3334db65bcf779ab8a274a0089310d84ec3d97eba55993da6ef9828401f3eba6
title: cron-seconds
type: adr
goal: |-
    Let `/cron` schedule work at sub-minute cadence, and make the resulting skip
    volume readable. Two syntaxes gain seconds — 6-field cron whose LEADING field
    is seconds (`*/30 * * * * *`) and `every Ns` interval sugar — with no minimum
    cadence, and consecutive skipped ticks collapse into one record carrying how
    many ticks it stands for instead of one durable event plus one transcript card
    per tick.
status: accepted
date: "2026-08-16"
---

## Goal

Let `/cron` schedule work at sub-minute cadence, and make the resulting skip
volume readable. Two syntaxes gain seconds — 6-field cron whose LEADING field
is seconds (`*/30 * * * * *`) and `every Ns` interval sugar — with no minimum
cadence, and consecutive skipped ticks collapse into one record carrying how
many ticks it stands for instead of one durable event plus one transcript card
per tick.

## Context

A user asked for a job every 2 seconds. The parser refused, the LLM-repair path
took over, and the agent told them "cron cannot run more often than every 1
minute" — then armed `every 1m` instead. Nothing in the engine required that
refusal: occurrence math is delegated to the `cron` npm package, whose
`CronTime` has always read a 6-field expression as seconds-first, verified here
against the installed cron@4.4.0 (`*/30 * * * * *` from 17:00:00 yields
17:00:30, 17:01:00, 17:01:30, and stays strictly-after at second granularity).
The refusal came from two hand-written branches in `parse-schedule.ts`
("seconds are not supported", "Kanna cron has no seconds field") and from the
grammar prose derived from them, which is exactly what the repair prompt teaches
the model.

Opening the parser alone would ship a second defect. Skip-and-record assumes
ticks are rare relative to run duration: every skipped tick writes a
`cron_run_skipped` event onto the auto-continue JSONL (never compacted, held
per-chat in memory) AND a transcript card. At minute cadence that is right — the
miss is news. At `every 5s` against a 20-second task it is three cards per
cycle, roughly 2000 an hour, burying the runs that did happen. The affected
topology is the shared cron domain (grammar, schedule shape, humanizer) and the
server cron feature (fire path, skip bookkeeping); the client cron UI renders
the count but owns no decision.

## Decision

Seconds are the ENGINE's shape, not Kanna's invention: `parseCronFields` accepts
5 or 6 tokens and prepends a `second` spec (0-59) for the 6-field form, passing
the expression through to `CronTime` untouched, and `CronSchedule.second` is
OPTIONAL so every job armed before this replays from the durable log unchanged.
`every Ns` joins `m` and `h` in the interval regex. There is no minimum cadence
and no setting for one — per the user's call, `/cron` is the only place a
cadence is chosen; `every 1s` arms. The seconds vocabulary is added to
`repair-report.ts` and the `validate_cron` tool description in the same change,
because the model's refusal came from that prose and would otherwise survive the
parser fix.

Skip volume is bounded at the WRITE, by a per-job leading-edge throttle
(`CronSkipCoalescer`): the first skip after a quiet stretch is written
immediately (a `@daily` job skipped at 09:00 must say so at 09:00, and a
window can only be noticed by a later tick — holding it would delay that notice
by a day), skips inside the window are counted, and the folded count is written
by the first tick or run past the window. Counting at the tick beats deriving
the count in `deriveCronJobs`: derivation means walking
`CronTime.getNextDateFrom` across the streak, MEASURED at ~42 us per call, on a
read model that runs on every chat broadcast. The count rides the existing
`missedCount` field, which becomes "how many fires this row represents" rather
than a server_offline-only count.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-311 | component | Owns the grammar and the CronSchedule shape: parseSchedule now accepts a 6-field expression with a leading second and every Ns, the schedule type gains an optional second field, and humanizeSchedule reads sub-minute cadences | c3-311#n11232@v1:sha256:a33141f48d104961f378d8c6ff6c8442740255236d290742c593c35f367d5a50 "CronSchedule shape" | rule-strong-typing: the optional second keeps every already-armed job's replay valid; rule-colocated-bun-test: parser + humanizer rows land beside their modules |
| c3-233 | component | Owns skip-and-record: the fire path now writes through CronSkipCoalescer, both fire paths flush the streak before starting a run, and emitCronEvent forgets a job's streak when it is armed, paused, or disarmed | c3-233#n10777@v1:sha256:bb129715bceacc1ea5d64ed3085f64adaed570c5c507192341256ce03c07bb78 "Fire" | ref-event-sourcing: the coalesced record is still an event first, only fewer of them; rule-colocated-bun-test: skip-coalescer.test.ts sits beside the module |
| c3-120 | component | Renders the coalesced count on the skip card ("Cron runs skipped 9x") and lists the seconds syntaxes in the help block; it reads CronRunSnapshot.missedCount, which already existed for server_offline, so no contract moves | c3-120#n8926@v1:sha256:f7a5e141225fcbed4fe2f1b26d273f0216b3fcf3029dcfd5678f4767ee55cbf0 "Owns every cron surface the user sees" | Design system: tabular-nums on the count |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | CronSchedule crosses the WS boundary AND the durable event log, so the new second field's optionality is a compatibility contract, not a convenience; CoalescedSkipReason is an Exclude over CronSkipReason so server_offline cannot reach the throttle | rule-strong-typing#n11641@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 "All boundary types must be named exports (interface or discriminated union) declared in src/shared/** or the owning module" | comply |
| rule-colocated-bun-test | Every changed module keeps its colocated suite, and the new skip-coalescer.ts ships skip-coalescer.test.ts with it | rule-colocated-bun-test#n11580@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A minimum-cadence setting (Settings knob, default 10s) | The user rejected it outright: a cadence is chosen in /cron and nowhere else. A second place to configure it would also be a second place to disagree with the line the user actually typed |
| Deriving the skip count in deriveCronJobs instead of counting at the tick | MEASURED 42 us per CronTime.getNextDateFrom call; a 100-tick streak is 4 ms per derive, on a read model that runs on every chat broadcast |
| Holding the first skip of a streak so a burst becomes exactly one card | The window can only be noticed by a later tick, so a @daily job's 09:00 skip would go unreported until the next day's tick. The leading edge is what keeps slow schedules honest |
| Suppressing skip cards entirely for busy/overlap reasons, panel-only | A @daily job that silently did not run at 09:00 is exactly the question the card answers; the volume problem is sub-minute, and the fix belongs there |
| Rewriting every Ns into a 6-field cron expression | Same reason intervals were never rewritten: every 30s anchors at arm time, */30 * * * * * snaps to the clock. They are different schedules |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 6093 pass, 2 skip, 0 fail (498 files) — including new rows for 6-field parsing, seconds humanizing, the next-fire behavioral table at second granularity, CronSkipCoalescer, and fire-path coalescing |
| bun test --conditions production src/shared/cron/ src/server/cron/ | 165 pass, 0 fail; the existing suggestion drift guard still proves every emitted correction re-parses |
| bun run typecheck | Clean on TS7; making skipCoalescer required on CronFireDeps is what made a missing wiring a compile error rather than a silent per-tick write |
| bun run lint | Clean at --max-warnings=0 |
| Manual golden path | Arm /cron ... inline every 5s, watch runs ~5s apart with one counted skip row between them rather than one per tick; arm */20 * * * * * and confirm the panel countdown and next-fire times |
| mcp__kanna__validate_cron with /cron x inline every 2s | Answers VALID - every 2 seconds with three real fire times, instead of the refusal that started this |
