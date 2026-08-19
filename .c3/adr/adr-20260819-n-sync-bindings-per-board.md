---
id: adr-20260819-n-sync-bindings-per-board
c3-seal: 511361ada526b1829f36d5ad8857f315926594a1cd344eb3383a4b38709ed5d1
title: n-sync-bindings-per-board
type: adr
goal: |-
    Let one board hold one sync binding per repo, replacing the application-level
    assumption that a board syncs with exactly one tracker. `getBinding(boardId)`
    becomes `listBindings(boardId)`, the sync engine's pull and push loop over the
    list, and a failure on one binding is reported against that binding instead of
    being swallowed. This is the substrate a Stack board needs: a Stack spans many
    projects, so its board must reconcile many repos.
status: done
date: "2026-08-19"
---

## Goal

Let one board hold one sync binding per repo, replacing the application-level
assumption that a board syncs with exactly one tracker. `getBinding(boardId)`
becomes `listBindings(boardId)`, the sync engine's pull and push loop over the
list, and a failure on one binding is reported against that binding instead of
being swallowed. This is the substrate a Stack board needs: a Stack spans many
projects, so its board must reconcile many repos.

## Context

`board-store.adapter.ts` declares `CREATE INDEX sync_binding_board_idx ON
sync_binding (board_id)` — a plain, non-unique index. The table has always
permitted many bindings per board; nothing in the schema enforced one. What
enforced it was the read path (`getBinding` did `SELECT ... WHERE board_id = ?`
then `.get()`) and the write path (`upsertBinding` found the existing row by
`board_id` and overwrote its provider and source ref). The visible consequence
was that connecting a second repo to a board silently retargeted the first,
losing its cursor.

The reconcile itself was never the problem: `getSyncLinkByExternal(binding.id,
…)`, `dueOutbox(binding.id, …)` and `setBindingCursor(binding.id, …)` were
already `binding.id`-scoped, so per-binding correctness held the moment more
than one binding could exist. Only resolution and iteration were singular.

Two further defects surfaced once the loop existed. `pull` and `drain` wrapped
each binding in a bare `catch { continue }`, so a binding whose token had
expired or whose repo had been renamed reported a clean zero — indistinguishable
from "nothing to sync". And `DrainSummary.held` was declared but never
incremented, because `dueOutbox` filters held rows out before `drain` can count
them.

Note the contrast that bounds this change: `sync_link_external_idx` is `CREATE
UNIQUE INDEX ... ON sync_link (binding_id, external_id)` — unique per *binding*,
not per issue. Two bindings may therefore each hold the same issue as a separate
card, with two sync links and two outbox entries racing last-writer-wins. This
ADR does not prevent that; the one-repo-one-board rule that does is #760's, and
it needs the unbind path landed here.

## Decision

`listBindings(boardId): SyncBinding[]` replaces `getBinding`, and
`upsertBinding`'s identity moves from `board_id` to `(board_id, source_ref)` so
that binding a second repo adds a row rather than overwriting one. No migration
is required — the index was already non-unique, and an existing single-binding
board reads back as a one-element list.

`board-sync.ts` keeps its reconcile untouched and changes only its shape: the
per-binding pull and push bodies extract into `pullOneBinding` and
`drainOneBinding`, driven by loops in `pull` and `drain`. Extracting rather than
inlining the loop is what keeps the diff in the reconcile a pure re-indentation,
which is the reviewable property that matters here — the reconcile is the part
that must not change.

Failures become data instead of control flow. `BindingPullResult` carries
`bindingId`, `cursor`, `rateLimitRemaining` and `error`, and `PullSummary.cursor`
is deleted outright rather than aggregated: a single cursor over N bindings
belongs to no binding and would be read as though it did. A binding with no
registered adapter is reported with `provider: null` rather than dropped, so the
status screen can say why it is not syncing.

`BoardSyncStatus.suggestedRepo` becomes `RepoSuggestion[]` — one row per project
the board covers, a project board yielding at most one and a Stack board one per
member project. A project with no `origin` is listed with `repo: null` rather
than omitted, because the connect screen has to say "no remote" about it rather
than pretend the project does not exist. Each row costs a `git remote get-url`
subprocess, so `suggestSyncRepos` is reachable only from `board.sync.status`, a
request/response command, and never from a broadcast path.

The unbind path (`deleteBinding`, `unbindSync` with a cross-board ownership
check, the `board.sync.unbind` command) and `countHeldOutbox` ship here rather
than in #760. Both are consequences of N bindings existing at all: with one
binding, "disconnect" was indistinguishable from "rebind", and `held` could not
be counted because there was only ever one outbox to filter.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-232 | component | Owns the store port, the registry and the sync engine. Its BoardRegistry contract loses `getBinding` for `listBindings` and gains `unbindSync`; its Tracker sync contract becomes per-binding, including per-binding failure isolation | c3-232#n11096@v1:sha256:d8161c3abb4c208d15db7ddb37393f1078dbcf8f23a6ee558a5129ddc5c9158c | ref-side-effect-adapter and ref-cqrs-read-models both hold — the loop stays in the engine, the adapter stays the only SQLite importer |
| c3-119 | component | The sync panel's contract said it binds a board to *a* tracker; it now connects several, lists them, and disconnects one without touching the others | c3-119#n9259@v1:sha256:44cee1d73329ad6c49681fb54007e97847bf257532bbc07977c5e3bfe14314c4 | ref-ws-subscription — the panel still reads `board.sync.status` request/response, adding no subscription |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | The binding loop, `deleteBinding` and `countHeldOutbox` all touch persistence; only `board-store.adapter.ts` may import `bun:sqlite` | ref-side-effect-adapter#n10118@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply — the new store methods are declared on the `board-store.ts` port and implemented in the adapter; `board-sync.ts` takes them injected and imports no IO |
| ref-cqrs-read-models | `BoardSyncStatus` is derived per read, not persisted, so widening it to a list must not add stored state | ref-cqrs-read-models#n9985@v1:sha256:cc9d478fbc03fb946ec0feaf95b2e7bb2d9a0be5222850d04c8b5410718e9369 | comply — `bindings`, `suggestedRepos` and `routing` are all recomputed on every status read |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Store port | `getBinding` → `listBindings`; add `deleteBinding`, `countHeldOutbox`; `upsertBinding` keys on (board_id, source_ref) | src/server/board-store.ts, src/server/board-store.adapter.ts |
| Sync engine | `resolve` returns a list; extract `pullOneBinding` / `drainOneBinding`; add `BindingPullResult`; drop `PullSummary.cursor` | src/server/board-sync.ts |
| Registry | `listBindings`, `unbindSync` with a cross-board ownership check | src/server/board-registry.ts |
| Wire | `board.sync.unbind`; `BoardSyncStatus.bindings`; `suggestedRepo` → `RepoSuggestion[]` | src/shared/protocol.ts, src/shared/boards/sync-types.ts, src/server/ws-router-boards.ts |
| Suggestions | `suggestSyncRepos` walks a Stack's member projects, one `git remote get-url` each, request/response only | src/server/server.ts |
| UI | Connected repos render as a list with per-row disconnect; the repo field becomes an add row seeded with the next unbound suggestion | src/client/components/boards/BoardSyncPanel.tsx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| board-sync.test.ts | Two bindings each advance their own cursor; a push routes to the binding owning the card's sync link; a rate-limited binding does not block the other's pull; a binding failure is surfaced on the summary rather than swallowed | src/server/board-sync.test.ts |
| board-store.adapter.test.ts | (board_id, source_ref) identity; cursor preserved on re-bind; delete cascades sync links while the card survives | src/server/board-store.adapter.test.ts |
| ws-router-boards.test.ts | Status carries every binding; suggestions are per project; unbind leaves the other bindings intact | src/server/ws-router-boards.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep `getBinding` and add `listBindings` beside it | Two readers of the same table, one of which silently answers for the first row only. The singular reader is exactly the defect; leaving it callable guarantees a future call site reintroduces the bug. |
| Aggregate the per-binding cursors into `PullSummary.cursor` | A cursor is a per-binding watermark. An aggregate is a value no binding holds, and every consumer that read it would be reading a lie that typechecks. |
| Defer unbind and `RepoSuggestion[]` to #760 | Both are consequences of N bindings existing, not of the connect screen. With one binding, "disconnect" was indistinguishable from "rebind" and `held` could not be counted at all; splitting them would ship a state the UI cannot express. |
| Add a UNIQUE constraint on (board_id, source_ref) | The correctness rule that matters is one repo to one *board*, which is cross-board and cannot be expressed as a per-board unique index. #760 owns that rule; a per-board constraint would look like it and not be it. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A board carrying two bindings to the same repo double-imports every issue as two cards | `upsertBinding` keys on (board_id, source_ref), so re-binding the same repo updates rather than duplicates; the cross-board rule is #760's | bun run test --conditions production src/server/board-store.adapter.test.ts |
| Losing an existing board's cursor on upgrade | Identity widened, never narrowed — an existing row still matches on (board_id, source_ref) and its cursor is preserved on re-bind | bun run test --conditions production src/server/board-store.adapter.test.ts |
| `suggestSyncRepos` shelling out per project lands on a broadcast path and spawns N git subprocesses per push | Reachable only from `board.sync.status`, a request/response command; documented at both the definition and the dep declaration | src/server/server.ts, src/server/ws-router-boards.ts |
| One binding's failure silently degrading the whole board's sync to zero | Errors recorded per binding on `BindingPullResult` rather than caught and continued | bun run test --conditions production src/server/board-sync.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean, exit 0 |
| bun run lint | clean, exit 0, --max-warnings=0 |
| bun run test --conditions production src/server/board-sync.test.ts src/server/board-store.adapter.test.ts src/server/ws-router-boards.test.ts src/client/components/boards/BoardSyncPanel.test.tsx | 114 pass, 0 fail |
| bun run test | 6587 pass, 2 skip, 0 fail across 518 files |
