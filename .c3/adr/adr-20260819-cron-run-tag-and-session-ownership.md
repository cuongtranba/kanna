---
id: adr-20260819-cron-run-tag-and-session-ownership
c3-seal: 67813a2c82e887a1f51cd91d52ebccc4fcaa1e0c0562052a25c1380b5f3d6ab7
title: cron-run-tag-and-session-ownership
type: adr
goal: |-
    Make every cron run reach a recorded outcome, and stop the session-teardown
    paths from closing a Claude session that a turn is still spawning on. Two
    defects that compound: a cron run that never settles keeps re-firing
    `clearChatContext` on its arming chat, and a session torn down out of band
    leaves an `ActiveTurn` that never ends, so the chat reports busy forever.
status: done
date: "2026-08-19"
---

## Goal

Make every cron run reach a recorded outcome, and stop the session-teardown
paths from closing a Claude session that a turn is still spawning on. Two
defects that compound: a cron run that never settles keeps re-firing
`clearChatContext` on its arming chat, and a session torn down out of band
leaves an `ActiveTurn` that never ends, so the chat reports busy forever.

## Context

Observed on a live install (chat `20dc93f1`, inline job `cron-c5891b`, every
2 minutes). `turns.jsonl` records `turn_finished` at 12:00:49 for the run
started at 12:00:00, yet `schedules.jsonl` holds **no** `cron_run_outcome`
for it. Across the whole log there is not one `{ok: true}` outcome — every
run is settled by `fireCronJob`'s orphan self-heal at the following tick,
interleaved with long stretches of `cron_run_skipped: previous_run_active`.
The persisted queued message shows why: its keys are
`['attachments','content','createdAt','id']` — no `cronRun`.

`buildEnqueueMessageResult` constructs `QueuedChatMessage` by listing fields
one at a time and never copied `cronRun`. Nothing caught it: an omitted
optional property in an object literal is not a type error, the reducer that
projects the event spreads `...event.message` and so was already correct, and
the cron fire suite fakes `enqueueMessage` while hand-preserving the tag —
the fake was more faithful than production.

The tag is the only link between a fired run and the turn that answers it
(`fireCronJob` → `enqueueMessage` → dequeue → `ActiveTurn.cronRun` →
`store.onTurnTerminal` → `cron_run_outcome`). Without it `hasActiveRun(job)`
stays true forever, so each later tick either orphan-heals and restarts —
which on the inline path runs `clearChatContext`, killing and respawning the
chat's claude process every cycle — or skips.

Separately, three session-teardown gates each hand-rolled a busy-subset and
all three omitted `startingTurns`, the only signal that a chat is live during
the boot window (the `ActiveTurn` is registered only after the spawn
resolves). A warm session reused for a follow-up still carries the previous
turn's `lastUsedAt`, so it sorts first in LRU — the prime eviction victim is
the chat the user just returned to. And the runner could not clean up after
such a teardown: `closeClaudeSession` deletes the session-map entry first, so
the runner's `finally` no longer recognised itself and skipped
`recordTurnFailed`, `activeTurns.delete` and `pendingTools.discard` entirely.

## Decision

Stop re-enumerating the queued message: `buildEnqueueMessageResult` spreads
`...message` and overrides only what it owns — the generated `id`,
`createdAt`, and the defensive `attachments` copy. Enumerating was the defect
class, not just this instance; every future field on `QueuedChatMessage` now
survives by construction rather than by remembering.

Add `startingTurns` to `enforceClaudeSessionBudget`, `isClaudeSessionIdle`
and `clearClaudeSessionContext` so a booting turn's session is never torn
down. This aligns all three with `isChatBusy`, already the single busy
derivation for the send/drain gates.

Introduce `ActiveTurn.sessionId` so a dying session can tell whether the
chat's turn is **its** turn, and split the runner's `finally` guards by what
each actually owns: map delete and OAuth release key on residency, settling
the turn keys on ownership, and `pendingTools.discard` stands down only for a
superseding session. A turn that declares no session falls back to the old
residency rule, so a missing binding can never leave a turn unsettled.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent to c3-206/c3-210/c3-233 | N.A - ancestor row | N.A - no delta at this level |
| c3-2 | container | N.A - named only to complete the top-down descent to c3-206/c3-210/c3-233 | N.A - ancestor row | N.A - no delta at this level |
| c3-233 | component | Cron run attribution depended on a tag the queue silently dropped, so no run ever settled through onTurnTerminal | c3-233#n12056@v1:sha256:e12570efff03340944b0be3d5071fb11cede0982302efcf0121c96b1b7646e01 | New Change Safety row pinning the tag round-trip against the real store |
| c3-206 | component | buildEnqueueMessageResult is the store write op that lost the field; the queued message is the durable dispatch carrier | c3-206#n12057@v1:sha256:452161b399bfa0aef7967a133a5cb3068ac9f68249f391205445e00348ea6fee | New Change Safety row banning field enumeration in the builder |
| c3-210 | component | Session teardown and turn settlement live here; a ghost ActiveTurn starves every terminal-event consumer | c3-210#n12058@v1:sha256:ef1eeb347bb52e5fa96d7439240fff21a808d1d74eb9d3d279069a3cca23711c | New Change Safety row for teardown-during-boot and ownership-based settlement |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-colocated-bun-test | The regression for each changed module sits beside it, and the cron fire suite's hand-preserving fake is why the defect stayed green — the round-trip is now pinned against the real EventStore in event-store.test.ts | ref-colocated-bun-test#n11595@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| ref-event-sourcing | The queued message and every cron_* record are events; the lost tag was a write-op that persisted an incomplete event, and the fix restores the event's full payload | ref-event-sourcing#n11661@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply |
| ref-cqrs-read-models | deriveCronJobs projects run status from the outcome events; a run never settled leaves the projection permanently reporting "running" | ref-cqrs-read-models#n11628@v1:sha256:cc9d478fbc03fb946ec0feaf95b2e7bb2d9a0be5222850d04c8b5410718e9369 | comply |
| ref-local-first-data | buildEnqueueMessageResult writes the on-disk queued-message log that survives restart; the dropped field was absent from the persisted record, not just from memory | ref-local-first-data#n11694@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply |
| ref-provider-adapter | ActiveTurn.sessionId binds a turn to a Claude session; providers that run without one keep the prior residency behaviour, so the adapter boundary is unchanged | ref-provider-adapter#n11727@v1:sha256:3bcf82b74f0f034db61a050837c7182691d29b77181e6f6c7805be1f2e00e180 | comply |
| ref-tool-hydration | The runner's finally settles parked tool continuations; the fix changes when pendingTools.discard runs, so the hydration contract is in scope | ref-tool-hydration#n11831@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Every changed module gains its regression next to it: event-store-write-ops.test.ts, event-store.test.ts, claude-session-runner.test.ts, claude-session-lifecycle.test.ts, claude-session-state-queries.test.ts, claude-context-commands.test.ts | rule-colocated-bun-test#n11930@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| rule-strong-typing | The defect was invisible to the type system (an omitted optional property is legal); the fix removes the enumeration so the type now carries the field by construction, and startingTurns is added to each deps interface so every call site fails to compile until wired | rule-strong-typing#n11991@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add `cronRun` to the existing field list in buildEnqueueMessageResult | Fixes this instance and leaves the defect class: the next field added to QueuedChatMessage is lost the same silent way, with no compile or runtime signal. |
| Have fireCronJob bypass the queue and start the turn directly | The queue is the chat's durable "start once idle" trigger and the only thing `recoverQueuedMessages` can replay after a crash; bypassing it trades a settled run for a lost one. |
| Re-derive cron ownership from the event log at terminal time instead of tagging the turn | Requires an unbounded event walk on every turn finalize, and still cannot tell which of several queued messages the finishing turn came from. |
| Exempt cron-spawned sessions from the resident-session budget | Treats the symptom for one caller; the boot-window eviction hits any chat, and does nothing about the ghost ActiveTurn a teardown leaves behind. |
| Have closeClaudeSession settle the turn itself before deleting the entry | It is a synchronous leaf with no store access; giving it transcript writes would put IO in a lifecycle helper and duplicate the runner's cancel/fail branching. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Ownership check leaves a turn unsettled when sessionId is absent | `ownsActiveTurn` falls back to the residency rule when `active.sessionId` is undefined, so behaviour is never worse than before the binding existed | bun test src/server/claude-session-runner.test.ts |
| Runner settles a turn belonging to a newer session, wiping its bookkeeping | Settlement requires `active.sessionId === session.id`; a superseding session is left strictly alone, and pendingTools stands down for it | bun test src/server/claude-session-runner.test.ts |
| Sessions pile up past maxConcurrent because more chats are now protected | The budget was already a soft cap that skips protected sessions; startingTurns is bounded by turn boot, and the 60 s idle reaper still collects afterwards | bun test src/server/claude-session-lifecycle.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/event-store-write-ops.test.ts src/server/event-store.test.ts | 135 pass, 0 fail; both new tests confirmed red against the pre-fix builder |
| bun test --conditions production src/server/claude-session-runner.test.ts | 43 pass, 0 fail — ghost-turn settle and superseding-session no-op both covered |
| bun test --conditions production src/server/claude-session-lifecycle.test.ts src/server/claude-session-state-queries.test.ts src/server/claude-context-commands.test.ts | 119 pass, 0 fail — all three teardown gates refuse a booting chat |
| bun run test | 6546 pass, 2 skip, 0 fail across 517 files |
| bun run lint && bun run typecheck | clean, --max-warnings=0 |
