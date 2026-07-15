---
id: adr-20260715-trace-turn-run-config
c3-seal: 1a1393c0b1567ac11c7f388271d24b0bad31c95eb6412d28633299896c9d15da
title: trace-turn-run-config
type: adr
goal: |-
    Record the model + run configuration active at the start of every turn on the
    `turn_started` event so `turns.jsonl` is a self-contained trace of which
    provider, model, effort, service tier, plan mode, and Claude driver executed
    each turn — without cross-referencing chat records or server logs.
status: accepted
date: "2026-07-15"
---

## Goal

Record the model + run configuration active at the start of every turn on the
`turn_started` event so `turns.jsonl` is a self-contained trace of which
provider, model, effort, service tier, plan mode, and Claude driver executed
each turn — without cross-referencing chat records or server logs.

## Context

`turn_started` (sourceIndex 5, `turns.jsonl`) carried only `{ v, type,
timestamp, chatId }`. To answer "which model/driver ran this turn?" an operator
had to join against mutable chat state or scrape server logs, and per-turn
overrides (model swaps, plan-mode toggles, sdk↔pty driver differences) were not
durably captured at the turn boundary. The events-schema component (c3-205)
owns the discriminated event union and already documents specific per-event
payload contracts (`share.token_minted`, `share.token_revoked`) in its Contract
table, so a per-field trace addition fits the existing modeling.

## Decision

Add an optional `runConfig` field to the `turn_started` event, typed by a new
exported `TurnRunConfig` interface in `src/server/events.ts`
(`{ provider, model, effort?, serviceTier?, planMode, driver }`). It is optional
so historical events replay unchanged and the timing read-model ignores it.
`EventStore.recordTurnStarted(chatId, runConfig?)` threads it through; the emit
site in `AgentCoordinator.startTurnForChat` populates it from the turn args plus
`resolveClaudeDriverPreference()`. `driver` is the resolved claude driver
preference (`sdk`|`pty`); it is only semantically meaningful for claude turns.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-205 | component | Adds the turn_started.runConfig payload contract to the event union it owns | c3-205#n6260@v1:sha256:b752b3a9538b24110118f976c3cac289da640108f198d59d50f7e6c3de8dc5ac | Discriminated union stays typed (ref-strong-typing); additive optional field, no new kind |
| c3-206 | component | Persists the enriched event via recordTurnStarted into turns.jsonl | c3-206#n6497@v1:sha256:4cc9ab13aa77c33d084457bb2a8ae8c86ea9880e750b0204b007258211a97135 | No new IO path; additive field only |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | passes (TS7, no errors) |
| bun test --conditions production src/server/event-store.test.ts | 73 pass incl. new "recordTurnStarted persists the run config" + "omits runConfig when none is provided" |
| bunx eslint src/server/events.ts src/server/event-store.ts src/server/agent.ts | clean, no warnings |
