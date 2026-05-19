---
id: adr-20260519-subagent-live-progress-decouple
c3-seal: 708673007f96ccb557f2d9b24e328285178d1ddac6d6264ef4a3a19096679395
title: subagent-live-progress-decouple
type: adr
goal: |-
    Decouple subagent live-progress visibility from the global serialized disk
    `writeChain` so a delegated subagent's transcript entries and streamed text
    appear incrementally in the UI while the run is in flight, instead of staying
    blank then dumping in one burst at terminal. Concretely: for the ephemeral
    `subagent_*` event family only, apply the read-model projection to in-memory
    state synchronously and fire `onRunProgress` immediately, while the durable
    JSONL append continues asynchronously. Durable/structural events keep their
    current Append→fsync(apply)→notify ordering unchanged.
status: implemented
date: "2026-05-19"
---

## Goal

Decouple subagent live-progress visibility from the global serialized disk
`writeChain` so a delegated subagent's transcript entries and streamed text
appear incrementally in the UI while the run is in flight, instead of staying
blank then dumping in one burst at terminal. Concretely: for the ephemeral
`subagent_*` event family only, apply the read-model projection to in-memory
state synchronously and fire `onRunProgress` immediately, while the durable
JSONL append continues asynchronously. Durable/structural events keep their
current Append→fsync(apply)→notify ordering unchanged.

## Context

`mcp__kanna__delegate_subagent` blocks the main turn for the whole subagent
run, so the main loop emits nothing meanwhile; subagent progress is the only
signal. Commit #237 added `onRunProgress` (subagent-orchestrator.ts:528,
650-654 → agent.ts:1144-1151 `emitStateChange`) to broadcast per entry. It
does not work in practice: `appendSubagentEvent` (event-store.ts:1682) routes
through the single global `append()` (event-store.ts:1032-1039) whose pattern
is `this.writeChain = this.writeChain.then(async () => { await
appendFile(...); this.applyEvent(event) })`. `writeChain` is one
process-wide serial promise shared by every write (main transcript, turns
log, sidebar, subagent). `appendSubagentEvent` returns that chain tail, and
the orchestrator's `.then(onRunProgress)` therefore fires only after every
queued `await appendFile` (plus `capTranscriptEntry` for tool_result,
event-store.ts:1672) ahead of it drains. During a busy main turn the chain is
saturated, so the read-model projection and the broadcast are starved → UI
shows the subagent as hung, then all entries appear at once. Additionally
`subagent_message_delta` (onChunk, subagent-orchestrator.ts:624-637) never
calls `onRunProgress`, so streamed assistant text is invisible until a later
entry forces a snapshot. Affected topology: c3-206 (event-store) owns the
write path; c3-207 (read-models) projects; c3-210 (agent-coordinator /
subagent-orchestrator) wires progress; c3-205 (events-schema) defines the
unchanged event union. Constraint: this is a local-first, single-user tool
(ref-local-first-data) — subagent progress events are regenerable cosmetic
liveness, not authoritative user data.

## Decision

Add a scoped synchronous-apply path used only by `appendSubagentEvent`: apply
the event to in-memory state synchronously at call time, then enqueue a
disk-only append on `writeChain` (no second `applyEvent` in the chained
callback, so the entry is applied exactly once per process lifetime).
`appendSubagentEvent` no longer makes UI visibility wait on disk I/O. The
orchestrator calls `onRunProgress` directly (not chained on the returned
write promise) for `onEntry`, and adds a trailing-edge throttled
`onRunProgress` to `onChunk` so streamed text becomes visible incrementally.
This wins for this repo because the bottleneck is provably the serialized
`await appendFile` backlog, not ws-router (its 16ms coalesce + signature
dedup already pass subagent deltas since `subagentRuns` is in the chat
snapshot signature). Scoping the decouple to the `subagent_*` ephemeral
family keeps the c3-206 durability contract intact for structural events
(`chat_created`, `user_prompt`, `turn_finished`, result) which must not
advance in-memory ahead of disk. It is far smaller and lower-risk than a
per-chat write-chain refactor while fully removing the hang/burst symptom.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-206 | component | event-store: adds a scoped synchronous in-memory apply for subagent_* events; disk append stays async. Changes the Business-Flow ordering ("Append→fsync→notify", "write error → log not advanced") for this event family only. | ref-event-sourcing Override scope; update c3-206 Business Flow via /c3 change in same PR |
| c3-210 | component | agent-coordinator: subagent-orchestrator onEntry/onChunk progress wiring changes: fire onRunProgress without awaiting the store write chain; add throttled progress on text deltas. | ref-cqrs-read-models broadcast-on-change compliance |
| c3-207 | component | read-models: projection logic unchanged but now invoked synchronously/earlier for subagent events; output shape identical. | Confirm projection stays pure (no I/O) — review only |
| c3-205 events-schema | N.A - no new or modified event types; the subagent_* event union is unchanged | N.A - no schema change | N.A - no schema change |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | The decision changes "mutation emit → derivation follows" timing: for subagent_* events the derivation (in-memory apply + notify) now runs before the durable disk append completes. | review + Override: document scope = only ephemeral subagent_entry_appended / subagent_message_delta / subagent_run_started; append-only JSONL, replay, and compaction are unchanged |
| ref-cqrs-read-models | Governs "broadcast diffs on change, not on request" and "pure projections, no I/O". The fix makes broadcast actually fire on change (immediately) and must not introduce I/O into projection. | comply |
| ref-local-first-data | Durability story: data under ~/.kanna, no remote replication. The crash-window for unflushed ephemeral subagent events is acceptable only because of single-user local-first scope. | comply |
| ref-strong-typing | New throttle helper and progress wiring cross the orchestrator↔store boundary; must be named-typed, no any/untyped. | comply |
| ref-colocated-bun-test | Cited by c3-206 and c3-210 (both affected). New/changed tests must sit next to source and run under bun test. | comply |
| ref-provider-adapter | Cited by c3-210. The decision changes write/notify timing only; subagent entries are still produced via the existing Claude/Codex provider normalization, which is not modified. | N.A - provider normalization unchanged by this ADR |
| ref-tool-hydration | Cited by c3-210. Tool-call entries are already normalized by src/shared/tools.ts upstream; the ordering/timing change does not alter hydration. | N.A - tool-call hydration unchanged by this ADR |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | New/changed tests must sit next to source under bun test (event-store.test.ts, subagent-orchestrator.test.ts), no separate test dir. | comply |
| rule-strong-typing | All values crossing the store/orchestrator boundary (throttle handle, callbacks) must have a named TypeScript type; no any/untyped object literals. | comply |
| N.A - no client UI-local store changed by this ADR (server-only change; positional/render #4 explicitly out of scope) | N.A - rule-zustand-store does not apply: no Zustand store touched | N.A |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| event-store.ts | In appendSubagentEvent, apply the event to in-memory state synchronously (this.applyEvent(event)), then enqueue a disk-only append on writeChain whose chained callback does NOT call applyEvent again; keep .catch logging on disk failure. Refactor append() to allow a disk-only enqueue variant without duplicating the reducer. | src/server/event-store.ts:1032-1039,1666-1683 |
| subagent-orchestrator.ts | onEntry: call this.deps.onRunProgress?.(chatId, runId) directly after appendSubagentEvent (drop the .then(writeChain) dependency); keep .catch log. onChunk: add a trailing-edge throttled (~100ms) onRunProgress. | src/server/subagent-orchestrator.ts:624-665 |
| event-store.test.ts | New cases: subagent event visible via getSubagentRuns() before writeChain settles; no entry duplication (entries length == event count); disk-failure path still logs and in-memory remains advanced. | src/server/event-store.test.ts |
| subagent-orchestrator.test.ts | New cases: onChunk triggers throttled onRunProgress; onEntry fires onRunProgress without awaiting the store write chain; final text visible after terminal. | src/server/subagent-orchestrator.test.ts |
| C3 doc sync | Update c3-206 Business Flow rows (Primary path / Failure) to record the scoped ephemeral exception, via /c3 change in the same PR. | c3-206 Business Flow section |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - product code only | N.A - no C3 CLI command, validator, schema row, hint, help, or template is changed by this decision; enforcement is via colocated bun tests named in Enforcement Surfaces | N.A - c3x check unaffected; product-code drift caught by bun test src/server/event-store.test.ts src/server/subagent-orchestrator.test.ts |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/event-store.test.ts | Asserts a subagent_entry_appended is observable via getSubagentRuns() synchronously (before the write chain resolves) and is applied exactly once. | New test cases in src/server/event-store.test.ts |
| bun test src/server/subagent-orchestrator.test.ts | Asserts onEntry and throttled onChunk invoke onRunProgress without awaiting the store write chain; final text present after run. | New test cases in src/server/subagent-orchestrator.test.ts |
| bun run lint | Strong-typing guard: no any/untyped at the new orchestrator↔store boundary; warnings ≤ cap. | CLAUDE.md lint ratchet, .github/workflows/test.yml |
| c3-206 Business Flow doc | Records the scoped ephemeral ordering exception so future readers/audits see the Override, not silent drift. | c3x read c3-206 --section "Business Flow" after /c3 change |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Per-chat write chains instead of one global chain (option #3) | Large refactor touching every append() caller and the c3-206 replay/compaction contract broadly; high regression risk for durable events; the scoped sync-apply removes the symptom without that blast radius. |
| Change global append() to apply-before-fsync for ALL events | Weakens durability ordering for structural events (chat_created, user_prompt, turn_finished, result) → real user-data loss window on crash; a broad c3-206 contract break rather than a scoped Override. |
| Anchor the subagent block to the delegate_subagent tool-use id for in-sequence placement (#4) | Different concern (visual placement, not liveness); does not fix hang/burst; deferred to a separate follow-up ADR to keep this work order tight. |
| Tighten/shorten ws-router coalesce (16ms) or its signature dedup | Not the bottleneck — subagentRuns is already in the chat snapshot signature so deltas are not deduped; the backlog is the serialized await appendFile, not ws-router. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Crash between synchronous in-memory apply and the async disk append loses the last subagent progress event(s). | Scope limited to ephemeral subagent_* events (regenerable, cosmetic); durable/structural events keep strict Append→fsync→notify; .catch logs disk failure; boot replay rebuilds from disk. | event-store.test.ts crash-window case: simulate disk-append rejection, assert it is logged and in-memory state is still advanced; replay-from-disk excludes the unwritten event without corrupting the run. |
| Double application (synchronous apply + chained apply) duplicates run.entries. | The disk-only enqueue variant does NOT call applyEvent in its chained callback; reducer runs exactly once per process lifetime; boot replay applies from disk in a separate process. | event-store.test.ts: assert entries.length === number of appended events after several appendSubagentEvent calls. |
| Throttling onChunk drops the final streamed-text frame. | Trailing-edge throttle (fires after the quiet period) plus terminal onRunProgress/snapshot on run completion guarantees the last state is delivered. | subagent-orchestrator.test.ts: stream deltas then complete; assert final text visible in snapshot. |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/event-store.test.ts | Pass, including new synchronous-visibility, no-duplication, and disk-failure crash-window cases |
| bun test src/server/subagent-orchestrator.test.ts | Pass, including onEntry/onChunk progress-without-await and final-text cases |
| bun run lint | 0 errors; warning count ≤ CLAUDE.md cap |
| Manual: spawn delegate_subagent during a busy main turn | Subagent transcript entries and streamed text appear incrementally in the UI (no blank-then-burst, no perceived hang) |
