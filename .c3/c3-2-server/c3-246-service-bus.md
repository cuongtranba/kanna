---
id: c3-246
c3-seal: 0751a305dc12cadf28e8432b2b7d491aa79894c542710cab650dfca7f1110d74
title: service-bus
type: component
category: feature
parent: c3-2
goal: Publish every durable fact the server records on one in-process service bus, so that the inbox, notifications and an optional external mirror read a single stream instead of each tapping the EventStore and the registries separately.
uses:
    - ref-event-sourcing
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Publish every durable fact the server records on one in-process service bus, so that the inbox, notifications and an optional external mirror read a single stream instead of each tapping the EventStore and the registries separately.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. createInMemoryServiceBus is built once in createApplicationServices after store.initialize, and the EventStore tap is attached in the same step so boot replay publishes nothing. |
| Consumers | c3-206 event-store calls the tap after applyStoreEvent and after a transcript append; later components subscribe by subject pattern or register a mirror sink. |
| Boundary | Owns the envelope contract, subject taxonomy, pattern matching and in-memory fan-out. It does not persist anything and does not own any event it carries; the EventStore stays the store of record. |

## Purpose

Owns the BusEnvelope contract in src/shared/service-bus, the NATS-style subject matching, the in-memory ServiceBus with subscribers and mirrors, the table that decides which StoreEvent kinds become which subject (and which never leave the process), the transcript kind allow-list, the EventStore tap that turns an applied event or an appended entry into an envelope, and the optional NATS JetStream mirror: the JetStream settings model, the write-only token, the embedded nats-server installer and supervisor, the mirror with its bounded queue, the create-or-update reconcile of the stream and its durable consumers, the service-bus status topic and the Settings section. Non-goals: it does not store events, does not retry a failed subscriber, and never makes the EventStore wait for a broker.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Envelope payloads are JsonValue produced through safeJsonParse, and the subject table is typed as a record over every StoreEventKind so a new event kind is a compile error until it is decided | Mandatory | isBusEnvelope narrows a parsed envelope field by field. |
| ref-event-sourcing | ref | The tap publishes only after the event is on disk and folded, so a subscriber never sees a fact the log does not hold | Mandatory | The tap slot is set after initialize, so replay is silent. |
| ref-side-effect-adapter | ref | The bus itself performs no IO; any broker connection is a sibling adapter registered as a mirror | Mandatory | in-memory-service-bus.ts and event-store-tap.ts import no node or Bun IO. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| BusEnvelope | OUT | v 1, id, subject kanna.domain.event, ts, source, direction inbound or internal, idempotencyKey, optional chatId and projectId, payload as JsonValue | idempotencyKey is deterministic per event (store:kind:entity:timestamp, transcript:chat:entryId) so a mirror can dedupe | src/shared/service-bus/envelope.ts |
| ServiceBus port | IN/OUT | publish is synchronous and never throws; subscribe takes a NATS-style pattern with star and greater-than wildcards; addMirror registers a sink called after subscribers | A failing subscriber or mirror is logged and counted, never propagated to the publisher | src/server/service-bus/service-bus.ts |
| STORE_EVENT_SUBJECT | OUT | Every StoreEventKind maps to a subject suffix or null; null kinds (session tokens, subagent deltas, read state, source hash, compact failures, sidebar order) are never published | The satisfies record makes a missing decision a type error | src/server/service-bus/store-event-subjects.ts |
| EventStore tap | IN | onEventApplied after applyStoreEvent, onEntryAppended after the transcript write, for the kinds in TRANSCRIPT_BUS_KINDS only | Assistant text, tool calls and results stay off the bus | src/server/service-bus/event-store-tap.ts |
| JetStream reconcile | OUT | On every connect the stream named in settings is created or updated from the configured limits, subjects, discard and duplicate window, and the configured durable consumers are created or updated; consumers Kanna created earlier and no longer lists are deleted by their kanna-managed metadata tag, consumers it did not create are never touched | A change to retention, storage or replicas, or to an existing consumer's ack or deliver policy, is reported as an error naming the field rather than applied, because the server refuses it; a stream is never deleted | src/server/service-bus/jetstream-reconcile.ts |
| Embedded nats-server | IN/OUT | In embedded mode Kanna downloads the pinned nats-server release for darwin and linux into the data dir, verifies it against SHA256SUMS, writes a 0600 config with a loopback listener, the JetStream store limits and a generated token, starts it, restarts it with backoff after an unexpected exit and stops it at shutdown; Windows reports that external mode is required | The token lives only in settings.json and the 0600 config file, never in argv; the child inherits PATH only | src/server/service-bus/nats-server-process.adapter.ts |
| NATS mirror | OUT | When settings.serviceBus is enabled, every envelope is also published to a JetStream stream with Nats-Msg-Id set to its idempotencyKey; the first subject token is swapped for the configured prefix and the JSON body keeps the original subject; publishes queue in a bounded ring of 2000 and drop oldest with a counter when the broker is away | publish only pushes to the ring; connect, reconcile and drain never throw into the caller, so a broker outage never fails an EventStore append | src/server/service-bus/nats-mirror.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| EXPORTED_PROM_METRICS entries kanna_bus_published_total and kanna_bus_handler_errors_total | c3-246 Contract | Names must match the instruments the bus records | src/ops/alerting/rules.ts |
| CLAUDE.md Service bus section | c3-246 Contract | Wording is free; the publish-after-persist, replay-silent and never-throw invariants must survive | CLAUDE.md |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Boot replay publishes the whole history to subscribers | Setting store.tap before store.initialize resolves | The tap test asserts a second initialize on the same data dir publishes nothing | bun test --conditions production src/server/service-bus/event-store-tap.test.ts |
| A secret-bearing event reaches a mirror | Mapping session_token_set or pending_fork_session_token_set to a subject | The subject table test pins the null kinds | bun test --conditions production src/server/service-bus/store-event-subjects.test.ts |
| A subscriber failure breaks an EventStore write | Removing the guarded call in the in-memory bus | The bus test throws from a handler and asserts later handlers and mirrors still run | bun test --conditions production src/server/service-bus/in-memory-service-bus.test.ts |
| event-store.ts crosses the 700 line module budget | Adding a second tap call site or an import line | The architecture budget test fails module_unlisted | bun test --conditions production src/ops/architecture/budget.test.ts |
