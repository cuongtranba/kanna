---
id: c3-206
c3-version: 4
c3-seal: 53b5fc2b9ef2492a08a4e5d13f15d0feae8a86d0383b99a08062f992e43ca7e4
title: event-store
type: component
category: foundation
parent: c3-2
goal: Append events to JSONL, replay on boot, compact to snapshot.json when the log exceeds 2 MB.
uses:
    - ref-colocated-bun-test
    - ref-event-sourcing
    - ref-local-first-data
    - rule-colocated-bun-test
---

# event-store

## Goal

Append events to JSONL, replay on boot, compact to snapshot.json when the log exceeds 2 MB.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Persist agent + chat events durably and replay them on boot" |
| Category | foundation |
| Lifecycle | Singleton per server process |
| Replaceability | Replaceable provided append/replay/compact contract preserved |

## Purpose

Owns the JSONL event log: append-only writes, in-order replay on boot, snapshot compaction once the log exceeds 2 MB. Non-goals: projection logic, command handling, network — those live elsewhere.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Data dir created and writable | c3-204 |
| Input — events schema | Typed event union | c3-205 |
| Input — paths | Log + snapshot file paths | c3-204 |
| Internal state | In-memory log mirror + write queue | c3-206 |
| Initialization | Replays JSONL → snapshot before serving | c3-206 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Authoritative state survives restarts and compaction | c3-2 |
| Primary path | Append → fsync → notify subscribers | c3-207 |
| Override — subagent ephemeral | subagent_* events apply in-memory synchronously then enqueue a disk-only append (no second applyEvent in the chain callback); disk failure caught and logged, in-memory state remains advanced. Durable/structural events keep strict Append→fsync→notify. See adr-20260519-subagent-live-progress-decouple. | c3-206 |
| Alternate — replay | Boot replay rebuilds state from log + snapshot | c3-206 |
| Alternate — compact | Snapshot taken when log > 2 MB | c3-206 |
| Failure — write error | Surface to caller; log not advanced (structural events). Subagent ephemeral events: disk failure logged via .catch; in-memory already advanced. | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | Append-only log + snapshot strategy | must follow | One log per project |
| ref-local-first-data | ref | Files under ~/.kanna/data | must follow | No remote replication |
| ref-colocated-bun-test | ref | Tests live next to source | must follow | event-store.test.ts |
| rule-colocated-bun-test | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| append(event) | IN | Typed append, returns ack | c3-210 | src/server/event-store.ts |
| replay() | OUT | Yields events in order | c3-207 | src/server/event-store.ts |
| compact() | OUT | Writes snapshot.json + truncates JSONL | c3-206 | src/server/event-store.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Lost events on crash | Write order regression | Replay yields incomplete state | bun run test src/server/event-store.test.ts |
| Snapshot/log divergence | Compact bug | Boot replays stale state | bun run check plus replay smoke against src/server/event-store.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/event-store.ts | c3-206 Contract | Storage detail | src/server/event-store.ts |
| src/server/event-store.test.ts | c3-206 Contract | Test cases per surface | src/server/event-store.test.ts |

## Chat Op-Log (delta broadcast source)

`EventStore.chatOps` (`src/server/chat-op-log.ts`, pure in-memory) keeps a
per-chat monotonic `seq` + ring buffer (default 512) of `ChatOp`s.
`appendMessage` records one `entries.append` op per persisted entry (deduped
appends record nothing); `deleteChat`/prune clear the chat's log. The ring is
memory-only — durability stays with the transcript JSONL; a ring miss means
the WS subscriber falls back to a full snapshot. Parity between the snapshot
path and the ops path is enforced by `src/server/chat-ops-parity.test.ts`.

## Transcript cache

`TranscriptCache` (`src/server/event-store-messages.adapter.ts`) is a small
LRU (4 chats) replacing the former single-chat `cachedTranscriptRef`. Page
reads (`getRecentMessagesPage` / `getMessagesPageBefore`) use the no-clone
`getMessagesView` and clone only the returned window; the public
`getMessages` keeps full-clone semantics.
