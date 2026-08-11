---
id: adr-20260810-boards-sqlite-store
c3-seal: 7929dab7a844c7a14b16d955431ff465751b0455e09010e8a753dc42a1c5bf55
title: boards-sqlite-store
type: adr
goal: |-
    Give Kanna kanban boards — N per project, user-defined columns, two-way sync
    with an external tracker — and persist them in a SQLite database at
    `~/.kanna/data/boards.db` rather than in the append-only JSONL event log every
    other Kanna aggregate uses. This ADR authorizes a **second persistence engine**,
    scoped to the board aggregate only, and states what keeps that scope from
    spreading.
status: proposed
date: "2026-08-10"
---

# Boards persist in SQLite, not the event log

## Goal

Give Kanna kanban boards — N per project, user-defined columns, two-way sync
with an external tracker — and persist them in a SQLite database at
`~/.kanna/data/boards.db` rather than in the append-only JSONL event log every
other Kanna aggregate uses. This ADR authorizes a **second persistence engine**,
scoped to the board aggregate only, and states what keeps that scope from
spreading.

## Context

Every Kanna aggregate today is event-sourced: typed events appended to JSONL
under `~/.kanna/data`, replayed on boot, compacted into `snapshot.json`, and
projected into in-memory CQRS read models. `ref-event-sourcing` governs that,
and `bun:sqlite` is on the side-effect banned list.

Boards are a new aggregate whose defining feature is two-way sync with a remote
tracker. That workload needs three things a replayed log gives expensively or
not at all:

1. **A transactional outbox.** The card write and the intent to push it must
commit together. A crash between them loses the push silently: the user sees
a moved card and the tracker never hears about it. This is a correctness
requirement, not a performance one.
2. **Indexed lookup by external ref.** "Which card is issue #412?" runs for
every item of every pull. Against a log this is a scan.
3. **Per-field watermarks.** Echo suppression stores a timestamp per synced
field per link — a mutable two-level map read and written on every reconcile,
the shape a log is worst at.

Card ordering additionally wants an indexed `rank` column so a drag is one row
update, and a 5k-issue import wants paging rather than a full in-memory
projection. Both are real, but neither alone would justify a second engine.

## Decision

Boards persist in SQLite, in their own file beside the event logs. This narrows
the system-level Abstract Constraint "event sourcing for all state mutations"
(c3-0) to "all except boards". The override
of `ref-event-sourcing` is scoped to the board aggregate; nothing else changes
engine. `ref-local-first-data` is NOT overridden — the file sits in the same
local data directory and nothing leaves the machine unless the user connects a
tracker.

The scope is held by four structural constraints rather than by convention:

- **One file may open a handle.** `board-store.adapter.ts` is the only importer
of `bun:sqlite`, enforced by the existing side-effect lint. Everything above
it depends on the `BoardStore` port.
- **Migrations are append-only**, gated on `PRAGMA user_version`. A database
written by a newer build refuses to open rather than being silently
downgraded.
- **Stored JSON is decoded, not asserted.** `shared/boards/decode.ts` validates
every JSON column on the way in, so one corrupt label cannot make a card
unreadable.
- **The read model still broadcasts.** `board-registry.ts` is the only write
path and every mutation notifies subscribers — the same push-on-change
contract the event-sourced aggregates have, reached differently and pinned by
a test that enumerates the mutating surface.

Governance the implementation complies with, uncited here because these tables
are optional and the citations add no information the reader lacks:
`ref-local-first-data` (the file stays under the local data dir),
`ref-side-effect-adapter` (`bun:sqlite`, `Bun.spawn` and network calls each sit
in their own `.adapter.ts`), `ref-cqrs-read-models` (`board-registry.ts` is the
read model), `ref-strong-typing` and `rule-strong-typing` (stored JSON is
decoded at the boundary), `rule-colocated-bun-test`, and `rule-zustand-store`.

Ordering rests on one collation fact: SQLite's default BINARY collation sorts
fractional order keys exactly as JavaScript's `<` does, so `ORDER BY rank` needs
no COLLATE clause and no application-side sort. That parity is pinned by a test
rather than assumed.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2 | container | Gains the board store, registry, sync engine and GitHub adapters | c3-2#n7808@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend" | Confirm the side-effect seal still holds: one .adapter.ts per IO primitive |
| c3-206 | component | Precedent holder for persistence; boards deliberately do NOT use it | c3-206#n8109@v1:sha256:4bbe28051be1ca893e66e498279b8364077c001c1ffd682ea36f2f8c16266178 "Owns the JSONL event log: append-only writes" | Confirm the override is scoped and the event log is untouched |
| c3-205 | component | No board events are added to the typed event union | c3-205#n8059@v1:sha256:8aa024b15fa3f3209bbb2336871d7989023c2099f7a4215c7c626c0311af34b7 "Owns the discriminated union of every event written to the JSONL log" | Confirm boards introduce no event kinds |
| c3-207 | component | Boards use a sibling read model, not the event projections | c3-207#n8170@v1:sha256:a58472ad11b1c57852907b089782785a24635670c5164aff68c7e77f7d9e4f6c "Subscribes to event-store appends" | Confirm the projection pipeline is unchanged |
| c3-208 | component | Gains board subscription topics and board commands | c3-208#n8220@v1:sha256:844f303a1dc89a3fb56db4e575721a405353084678086a7abfeda0736c23c284 "Accepts upgraded WS sockets" | Confirm broadcast-on-change parity with existing topics |
| c3-226 | component | Gains the agent's board tools | c3-226#n9150@v1:sha256:3662433ffa80595c59767f37d755a8949d3fc7eeac5b47d47c35df15c6587242 "Owns the Kanna MCP host runtime" | Confirm context bounding and project scoping match the tracking-doc tools |
| c3-1 | container | Gains the board pane, the Boards page and their stores | c3-1#n7095@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience" | Confirm design gate + render-loop rules |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Boards in the JSONL event log | No transactional outbox. A crash between the card write and the push intent loses the push, and nothing detects it. |
| SQLite as a rebuildable read model over the log | Correct, and roughly twice the machinery: two write paths, a projection to keep honest, and the outbox still needs log and DB to commit together. Revisit if boards ever need cross-aggregate replay. |
| A remote database | Breaks ref-local-first-data. Kanna runs on the developer's machine and owns its data. |
| Integer card ordering | A move renumbers the column; two concurrent movers (a user and an agent) then fight over the same integers. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The second engine spreads beyond boards | One adapter may open a handle; the side-effect lint enforces it | bun run lint |
| Ordering corrupts silently if collation diverges | Parity pinned by a test; no COLLATE clause on any rank column | board-store.adapter.test.ts ordering-parity test |
| An agent silently closes a real issue | Agent-origin pushes are held unless the binding opts in | board-sync.test.ts held/queued pair |
| Sync echoes its own writes forever | Post-push watermark = the remote timestamp our write produced | board-sync.test.ts no-echo test |
| Boards are absent from log replay and snapshot compaction | Accepted; backups must copy boards.db too | stated in Consequences |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bunx ast-grep scan | clean |
| bun run build:client | clean |
| Board test suite | 183 pass, 0 fail |
| Full suite | 5319 pass, 1 pre-existing failure (uploads, fails identically on clean main) |
| SQLite/JS ordering parity | pinned by test in board-store.adapter.test.ts |
| Real GitHub pull | 16 cards from cuongtranba/kanna; 13 in the start column, matching the 13 real issues counted independently with gh api |
| Board tools reach the agent | buildKannaMcpTools returns 0 board tools without the registry and 5 with it |
