---
name: kanna-cron
description: The /cron feature — parser and refusal path, validate_cron / arm_cron tools, LLM self-repair (KANNA_CRON_REPAIR), arm confirmation (KANNA_CRON_CONFIRM), the arm_cron post-arm review, sub-minute (6-field) schedules and the skip coalescer, and cron run-event retention (compactCronRunEvents). Use whenever a task touches src/server/cron/**, a cron job that never fired, stayed running, was orphaned, skipped repeatedly, or a /cron line that was rejected.
---

# Kanna /cron

## `/cron` Self-Repair (KANNA_CRON_REPAIR)

`/cron` always intercepts and never starts a turn, so a rejected line used to be
terminal Kanna state. Chat `39b0d210` is what that cost: three
`cron_command_error` entries in 34 seconds, no suggestion on any of them, then
the user gave up. **The line they typed was recorded nowhere** — no
`user_prompt` is appended on this path — so neither the reader nor the model
could see what failed. Same two-layer shape as the mermaid gate, with the
parser as the deterministic layer.

- **`CronParseError.input` is required.** `parseCronCommand` stamps it once on
  the way out, over an internal `Outcome` type whose error omits it — so a
  failure path cannot record a defect without the line that caused it, and a
  newly added one will not compile. The error card renders it.
- **`validate_cron` / `arm_cron`** (`kanna-mcp.ts`) mirror `validate_mermaid`.
  Both answer from one `previewCronCommand` (`cron/preview.ts`) — the humanized
  schedule plus the next 3 real fire times, or the refusal — so the two tools
  can never disagree about a line, and both run the parser the send pipeline
  uses. `validate_cron` gates on a chat alone; **`arm_cron` also needs the
  injected `armCron`, supplied for main chats only** (`depth === 0`, like
  `setup_loop`) — a subagent's chat is ephemeral and must not leave recurring
  work behind. `AgentCoordinator.armCron` REFUSES a non-armable line instead of
  dispatching it; dispatching would card the failure and re-offer it to the
  model, so a model answering its own repair prompt would loop.
- **`createCronRepair`** (`cron/repair.ts`) is the escalation, shaped like
  `createMermaidGuard`. **Its bounds are load-bearing:** it stands down when the
  parser produced a `suggestion` (the card already offers a free fix — the
  analog of mermaid standing down on a repairable diagram); it covers
  arm-shaped `part`s only, never management-subcommand typos; it asks about a
  given line **once per chat** (32-entry bounded memory), because a model that
  cannot repair a line must not be asked every time the user retypes it; and it
  swallows its own failures. Unlike the mermaid guard it also **drains the
  queue** — `/cron` starts no turn, so nothing else ever would.
- **One refusal path.** `refuseCronCommand` (`cron/commands.ts`) appends the
  card and offers the line together, so a new refusal cannot record one without
  the other. A schedule that parses but never fires (Feb 30) escalates too, on
  a reconstructed canonical line.
- **Deterministic coverage widened** so escalation stays rare: `parseCronFields`
  pads a 2–4 field cron with wildcards (`0 3` → `0 3 * * *`), but only when the
  padded form actually parses — English like `9am every day` yields nothing and
  goes to the model.

`KANNA_CRON_REPAIR=disabled` turns the escalation off; the tools stay. See
`adr-20260816-cron-llm-repair`.

## `/cron` Arm Confirmation (KANNA_CRON_CONFIRM)

After a user types a `/cron` command that arms successfully, `createCronConfirm`
escalates the result to a model review turn so the user can confirm, adjust, or
disarm the job before it runs unchecked. This mirrors `createCronRepair`'s shape
exactly — same four bounds:

| `createCronRepair` bound | Confirm equivalent |
| --- | --- |
| Stands down when a suggestion exists | Arm-shaped failures only (this path never sees failures) |
| One ask per line | One confirmation per `jobId` — a re-arm is a new job |
| Stands aside for queued user message | Identical |
| Never throws into the send path | Identical |

**Only on the typed path.** `createCronConfirm` is wired into `buildCronCommandDeps`
but `armCron` (the `arm_cron` MCP tool) overrides `cronConfirm: undefined` — the
model path already instructs the model to call `AskUserQuestion` after arming
(see `arm_cron` post-arm review below), so double-confirming is worse than not
confirming.

The escalation enqueues a `formatCronConfirmRequest` prompt with
`autoContinue: { scheduleId: 'cron-confirm-<jobId>' }` and drains the queue
(`/cron` starts no turn, so nothing else would ever pick it up — same as the
repair path).

`KANNA_CRON_CONFIRM=disabled` turns the escalation off. See
`adr-20260818-cron-arm-confirmation`.

## `arm_cron` post-arm review

After a successful `arm_cron` call the tool result carries:

1. `Armed as <jobId>.` — the durable id the model can pass to `/cron remove`
   if the user wants to disarm.
2. `formatCronArmSummary` — the same structured summary the `cron_armed` card
   renders: schedule (human + raw), mode + consequence, next 3 fires, model, cwd.
3. An explicit instruction to present the config and confirm via
   `AskUserQuestion` — options: Confirm / Change schedule / Change mode /
   Change instruction / Disarm.

**This is a prompt contract, not an env-var gate.** The arming happens before
the review instruction is returned, so a timed-out or unanswered question
leaves the job armed — the correct direction to fail. The instruction covers
the change path: arm a corrected line, then `/cron remove <old-jobId>`.

`armCron` now returns `Promise<{ jobId: string }>` instead of `void`. Every
call site that forwards it (`claude-session-spawner.ts`, `claude-session-start.ts`,
`agent-coordinator-types.ts`) and every interface that
owns a `runCronCommand` slot (`claude-send-command.ts`, `ws-router-agent-ctrl.ts`)
carry the updated return type. See `adr-20260818-cron-arm-confirm-tool-result`.

**A multiline `/cron` message is its own `part` (`"multiline"`), not
`"subcommand"`.** Chat `061b8856` reproduced 39b0d210's dead end even with
`input` recorded: the user's message wrapped onto a second line, the guard in
`parseCronCommand` rejected it with `part: "subcommand"` and no `suggestion`,
and `REPAIRABLE_PARTS` excluded `"subcommand"` — so `createCronRepair.offer`
returned before ever asking the model, twice, with nothing else happening.
The exclusion was meant for genuine management-subcommand typos
(`/cron list extra`, `/cron remove` with no id), which always carry a
mechanical `suggestion` and so never actually reach that check — the
multiline guard was the only live path hitting it, and it isn't a subcommand
typo at all: a wrapped or multi-sentence instruction is still arm-shaped,
just with no mechanical way to collapse it to one line. `"multiline"` is
listed in `REPAIRABLE_PARTS` so it escalates to the model like any other
unfixable arm.

## `/cron` sub-minute schedules

Seconds are **node-cron's own shape, not Kanna's invention**: `CronTime` reads a
6-field expression as seconds-first, so `parseCronFields` accepts 5 **or** 6
tokens (prepending a `second` spec, 0–59) and hands the expression through
untouched. `every Ns` joins `m`/`h` in the interval regex. **There is no minimum
cadence and no setting for one** — a cadence is chosen in the `/cron` line and
nowhere else; `every 1s` arms.

- **`CronSchedule.second` is OPTIONAL, deliberately.** `cron_armed` persists the
  whole schedule object on the auto-continue log, so every job armed before this
  replays without the field; absent reads as the 5-field "at second 0". Making
  it required would strand them.
- **The model's vocabulary is part of the feature.** The refusal users hit
  ("cron cannot run more often than every 1 minute") came from
  `repair-report.ts`'s grammar prose and the `validate_cron` tool description,
  not from the engine. Both now name the seconds forms; a parser change without
  them leaves the model refusing what the parser accepts.
- **Consecutive skips collapse into one counted record** (`cron/skip-coalescer.ts`),
  because skip-and-record assumed ticks are rare relative to run duration — true
  at minute cadence, false at `every 5s` against a 20 s task (3 cards per cycle,
  ~2 000/hour, into a JSONL log that is never compacted). It is a per-job
  **leading-edge** throttle: the first skip after a quiet stretch writes
  immediately — a `@daily` job skipped at 09:00 must say so at 09:00, and a
  window can only be noticed by a LATER tick, so holding it would delay that
  notice by a day — then skips inside the window are counted and the folded count
  is written by the first tick or run past it. Both fire paths `flushPending`
  before starting a run so the tail lands next to the run it waited on;
  `emitCronEvent` `forget`s a job's streak on arm/pause/disarm.
- **The count is tallied at the tick, never derived at read time.** Deriving it
  means walking `CronTime.getNextDateFrom` across the streak — MEASURED at ~42 µs
  per call — inside `deriveCronJobs`, which runs on every chat broadcast. It
  rides the existing `missedCount`, whose meaning widens from server-offline-only
  to "how many fires this row represents".
- `skipCoalescer` is **required** on `CronFireDeps` (optional on
  `CronCommandDeps`, where it only cleans up): a missing wiring must be a compile
  error, not a silent return to one write per tick.

See `adr-20260816-cron-seconds`.

## Cron run-event retention (`compactCronRunEvents`)

The auto-continue log never expires, so a recurring `/cron` job wrote into it
forever. MEASURED on one install: 8,507 cron run events were **96%** of every
auto-continue event and **69%** of the whole snapshot (2.29 MB of 3.34 MB),
worst chat 2,599. That array is resident in memory AND re-walked by
`deriveCronJobs` on every chat broadcast (`read-models.ts`) and for every chat
on the global cron topic (`ws-router-envelope.ts`) — so the cost of an
unrelated UI update grew with the number of fires.

`src/server/cron/compact.ts` keeps each job's newest `MAX_RECENT_CRON_RUNS`
**settled** runs plus **every run still in flight**, and reclaims everything
before a job's most recent `cron_armed`. Re-measured on the same data after the
change: 8,860 → 353 events (−96%), 2.16 MB → 677 KB (−69%), worst chat
2,603 → 11, with **zero** read-model difference across all 21 chats.

**Why it is safe:** `pushRun` already discards everything past
`MAX_RECENT_CRON_RUNS`, so this only stops STORING what the read model throws
away. Retention is DERIVED from that display cap, not chosen — there is no N to
set wrong. `deriveCronJobs` and `findRunningCronRuns` are the complete reader
set and both are asserted unchanged over a compacted log.

**Three invariants that are load-bearing, not defensive:**

1. **Never drop an unsettled `cron_run_started`.** `evictSettled` only selects
   settled records. Losing a live start inverts `hasActiveRun` (`fire.ts`),
   which starts a CONCURRENT run — and inline mode then calls
   `clearChatContext` on a live turn.
2. **Drop a start and its outcome atomically.** They share one record. A
   surviving half-pair makes `reconcileCronRunsAtBoot` write a bogus
   `errorCode:"orphaned"` — every boot, forever.
3. **Evict oldest-first, and do NOT count in-flight runs against the budget.**
   `CronScheduler.rehydrate` reads the newest record as `lastSeen`; losing it
   makes boot emit a false `server_offline` skip claiming up to 100 missed
   fires. Charging a pin against the budget would evict a settled record still
   inside the read model's newest-N window.

Applied at the only two places the per-chat array is built:
`applyAutoContinueToState` (shared by live append AND boot replay) and the
snapshot load in `event-store-snapshot.ts`. Do NOT add a third enforcement
point — `buildSnapshotFile` serializes already-compacted memory.

**Irreversible.** Once `snapshotAndTruncateLogs` runs the dropped events are
gone from `schedules.jsonl`; reverting the module does not bring them back. The
user-visible record lives in the transcript log (`cron_run` cards), a different
log that is never compacted.

**The corpus has since outgrown the numbers above.** Re-measured 2026-08-19:
1.0 GB across 262 chats, largest single transcript **96 MB / 36k entries**
costing **524 MB peak RSS** to parse (5.4x, not 4.7x). `evict()` previously
kept a `size > 1` guard that prevented the sole cached entry from being dropped
even once it grew past `maxBytes` via `appendTo()` — pinning 524 MB RSS
permanently. The guard is removed: a solo entry that exceeds the budget IS
evicted, and subsequent reads use `getRecentMessagesPageTail` (a small tail
chunk, not a full load) because the hot paths — history primer,
proactive-compact trigger, subagent scope primer — already took the tail path
when the transcript is not in cache. **pm2 7.0.3 silently clamps
`max_memory_restart` at 2^31** (both `"3G"` and `"4G"` resolve to
`2147483648`), so raising the ceiling is not available — only lowering RSS is.
