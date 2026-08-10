# ADR — Boards persist in SQLite, not the event log

Date: 2026-08-10 · Status: accepted · Scope: boards only

## Pattern override

This overrides `ref-event-sourcing` **for the board aggregate only**. Every
other Kanna aggregate keeps its append-only JSONL log. `ref-local-first-data`
is NOT overridden: the database file is `~/.kanna/data/boards.db`, beside the
event logs, and nothing leaves the machine unless the user connects a tracker.

## Why the pattern does not fit here

Two-way sync needs three things a replayed log gives expensively or not at all:

1. **A transactional outbox.** The card write and the intent to push it must
   commit together. A crash between them loses the push silently — the user
   sees a moved card and the tracker never hears about it. This is the decisive
   reason; the other two are cost, this one is correctness.
2. **Indexed lookup by external ref.** "Which card is issue #412?" runs on every
   item of every pull. Against a log this is a scan.
3. **Per-field watermarks.** Echo suppression stores a timestamp per synced
   field per link. That is a mutable map keyed two levels deep, read and written
   on every reconcile — the shape a log is worst at.

Card ordering also wants an indexed `rank` column so a drag is one row update,
and a 5k-issue import wants paging rather than a full in-memory projection. Both
are real but neither alone would justify a second engine.

## What keeps the override contained

- **One file may open a handle.** `board-store.adapter.ts` is the only importer
  of `bun:sqlite`, enforced by the existing side-effect lint. Everything above
  it depends on the `BoardStore` port.
- **Migrations are append-only**, gated on `PRAGMA user_version`. A database
  from a newer build refuses to open rather than being silently downgraded.
- **Stored JSON is decoded, not asserted.** `shared/boards/decode.ts` validates
  every JSON column on the way in; one corrupt label does not make a card
  unreadable.
- **The read model still broadcasts.** `board-registry.ts` is the only write
  path, and every mutation notifies — the same push-on-change contract the
  event-sourced aggregates have, reached differently.

## Ordering rests on a collation fact

Ranks are fractional order keys compared as strings. SQLite's default BINARY
collation sorts them exactly as JavaScript's `<` does, so `ORDER BY rank` needs
no COLLATE clause and no application-side sort. That parity is pinned by a test
rather than assumed; do not add a collation to any `rank` column.

## Rejected alternatives

| Alternative | Rejected because |
| --- | --- |
| Boards in the JSONL event log | No transactional outbox. A crash between the card write and the push intent loses the push, and nothing detects it. |
| SQLite as a rebuildable read model over the log | Correct, and roughly twice the machinery: two write paths, a projection to keep honest, and the outbox still needs the log and the DB to commit together. Revisit if boards ever need cross-aggregate replay. |
| A remote database | Breaks `ref-local-first-data`. Kanna runs on the developer's machine and owns its data. |

## Consequences

- Boards do not appear in the event log, so they are absent from snapshot
  compaction and from any future log-replay audit.
- Two persistence engines now exist. A reader must know which aggregate uses
  which; this ADR and the adapter header are where that is written down.
- Backup means copying `boards.db` as well as the JSONL files.
