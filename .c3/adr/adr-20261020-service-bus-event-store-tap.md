---
id: adr-20261020-service-bus-event-store-tap
c3-seal: 2edfc38c1abf7ddfcca980171fe35797f487776242cc4e9b6d0fad843dafc6db
title: service-bus-event-store-tap
type: adr
goal: Record the decision to give the EventStore a single publish seam, the tap slot, called after an event is applied and after a transcript entry is appended, so that the new service-bus component (c3-246) can mirror every durable fact without a second callback per registry.
status: done
date: "2026-10-20"
---

## Goal

Record the decision to give the EventStore a single publish seam, the tap slot, called after an event is applied and after a transcript entry is appended, so that the new service-bus component (c3-246) can mirror every durable fact without a second callback per registry.

## Context

Kanna had no event bus. The EventStore wrote JSONL logs and folded state, and every "something changed" signal was a hand-wired callback, several of them single-slot (onTurnTerminal, onCronJobsChange), so a second listener silently replaced the first. Inbound triggers (webhooks, cron, loop wakes) all converge on enqueueMessage but leave different traces, and nothing records them in one place. The planned Inbox, notifications and an optional embedded NATS mirror all need one stream of what the store of record accepted. event-store.ts sits exactly on the 700-line module budget, so the seam has to cost no net lines.

## Decision

Add a tap slot on EventStore (type EventStoreTap) with two methods: onEventApplied, called in applyEvent right after applyStoreEvent, which is the one place every durable fact passes after its disk write, including chat-task and subagent events; and onEntryAppended, called in appendMessage right after the transcript write, because transcript entries bypass commit. The slot is set in createApplicationServices after store.initialize resolves, so boot replay publishes nothing. The three lines are paid for by collapsing three double-blank lines, keeping the module at 700. Tapping applyEvent wins over wiring the bus into the forty emitStateChange call sites or the registries' subscribe sets, which carry no payload and would have to be mirrored one by one.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | Gains the tap slot and two call sites; its Contract gains the tap surface | c3-206#n15026@v1:sha256:70681644d96dfca428f473ae881848aba6c4264535ca617a26dbd7c98392823e | The tap runs after the disk write and fold, so ref-event-sourcing's append-then-derive order is preserved; no IO is added to event-store.ts |
| c3-246 | component | New owner of the envelope, subject table, in-memory bus and the tap implementation | c3-246#n14895@v1:sha256:af8dbb17ed5261c1e163be7ee06099b9192ee62785757c2c37f8f5f94fe5f72b | Pure modules only; broker IO arrives later as a mirror adapter |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| EventStore | tap slot beside onTurnTerminal; tap?.onEventApplied in applyEvent; tap?.onEntryAppended in appendMessage; three blank lines removed | src/server/event-store.ts |
| Service bus | envelope, subject matching, in-memory bus, STORE_EVENT_SUBJECT table, createBusTap | src/shared/service-bus/envelope.ts, src/server/service-bus/ |
| Boot | bus created and tap attached after store.initialize; bus exposed on ApplicationServices | src/server/server.ts |
| Metrics | kanna_bus_published_total and kanna_bus_handler_errors_total added to EXPORTED_PROM_METRICS | src/ops/alerting/rules.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Wire the bus into every emitStateChange call site | About forty sites, no payload, and a UI broadcast signal is not a domain event |
| Subscribe to each registry's subscribe set | Carries no event, misses StoreEvents entirely, and single-slot callbacks would be replaced |
| Add a new StoreEvent log for bus records | The store of record already holds every event; a mirror needs a seam, not a second log |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Boot replay floods subscribers with history | The slot is set only after initialize resolves | bun test --conditions production src/server/service-bus/event-store-tap.test.ts |
| A subscriber failure breaks a store write | The in-memory bus guards every handler and mirror call | bun test --conditions production src/server/service-bus/in-memory-service-bus.test.ts |
| A secret-bearing event is published | STORE_EVENT_SUBJECT maps the token kinds to null and a test pins them | bun test --conditions production src/server/service-bus/store-event-subjects.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean |
| bun run check:arch | 69 pass, no pin changed |
| bun run test | 9013 pass, 0 fail |
