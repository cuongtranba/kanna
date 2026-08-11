---
id: adr-20260811-board-column-semantics-single-source
c3-seal: 04ee7192c9d6aca526937e3af73383a82f110e9deedbc12d854a777e92e8d148
title: board-column-semantics-single-source
type: adr
goal: |-
    Give boards a sync configuration screen and column CRUD, and in doing so settle
    a question the schema had left open twice: how a tracker's state meets a board's
    user-named columns. Column semantics (`start` / `active` / `review` / `done`)
    becomes the single mechanism, the `column_mapping` table stays unused rather
    than being wired up as a second one, and the sync screen therefore SHOWS the
    routing instead of offering it.
status: proposed
date: "2026-08-11"
---

# Column semantics is the only way to say where a card goes

## Goal

Give boards a sync configuration screen and column CRUD, and in doing so settle
a question the schema had left open twice: how a tracker's state meets a board's
user-named columns. Column semantics (`start` / `active` / `review` / `done`)
becomes the single mechanism, the `column_mapping` table stays unused rather
than being wired up as a second one, and the sync screen therefore SHOWS the
routing instead of offering it.

## Context

Three features now key on `ColumnSemantic`. Sync routes a pulled issue to the
column marked `start` and reads `done` as closed. `Start work` moves a card to
`active`. A card reaching `done` is asked about its worktree. Until this change
none of that was visible anywhere in the product: `semantic` could only be set
by instantiating a template, and no screen mentioned it.

Meanwhile `column_mapping` (binding_id, column_id, remote_kind, remote_value)
has been in the SQLite schema since P0 with no `BoardStore` method, no writer
and no reader — a designed extension point for mapping a column to a GitHub
label or project field. Building the sync screen forced the question: wire it
up, or commit to semantics.

The mechanics of routing were also duplicated. `board-sync.ts` held private
`columnForState` and `stateOfCard` helpers; anything else that wanted to say
where a card would land had to reimplement them, which is exactly what a
configuration screen has to do.

Column CRUD had a matching gap: `updateColumn` / `moveColumn` / `deleteColumn`
existed on `BoardRegistry` but only `create` had a WS command, so a board's
columns could not be renamed, reordered, retyped or removed after
instantiation.

Affected topology: the WS router (c3-208) gains four commands and enriches
`board.sync.status`; the board pane and its panels (c3-1) gain the screens.

## Decision

**Semantics is the mechanism; `column_mapping` stays dead.** Open/closed is the
one state every tracker has, and a board's columns are the user's own, so the
two meet through `ColumnSemantic` and nowhere else. A second mechanism would be
a second way for the screen and the engine to disagree about where a card lands
— and disagreeing silently, since neither would be wrong on its own terms. The
table is left in place rather than dropped: it costs nothing, and the day a
provider needs per-column label mapping the shape is already there to argue
about. Nothing reads it, so nothing can quietly start depending on it.

**One definition, two callers.** `columnForRemoteState` and
`remoteStateOfColumn` move to `shared/boards/types.ts` beside the existing
`findActiveColumn` / `findDoneColumn`. `board-sync.ts` loses its private copies
and calls them; `board.sync.status` calls the same function to report routing.
What the screen promises is therefore what the engine does, by construction.

**The sync screen shows routing and warns rather than blocks.** A board marking
neither column still syncs — a one-way pull does not need them — and the
warning says exactly what will happen instead ("pulled issues land in the first
column", "nothing on this board can close an issue"). Blocking would be wrong:
the useful thing a board can do first is import, and semantics can be set
afterwards.

**The repo is read, not asked for.** `board.sync.status` returns the
`owner/repo` of the project's `origin` remote as a default, and `parseRepoSlug`
accepts a bare slug, a browser URL, or an SSH remote. A bound board shows its
BINDING rather than the suggestion, because a screen displaying a repo the board
is not bound to would be lying.

**The column popover names roles by behaviour.** Since `semantic` is now
load-bearing across three features, the picker reads "Start work moves a card
here" and "Closes the issue, and asks about the worktree" rather than exposing
the enum. This copy is the only place in the product that explains how the three
features meet.

**Reorder is the only optimistic column edit.** A drag must land under the
cursor. A rename or a delete is a deliberate act with a visible outcome, so it
waits one round-trip for the authoritative snapshot; a guess could only
disagree with it. The kanban library reports a drop as `(fromIndex, toIndex)`;
`resolveColumnMove` converts that to the neighbour the store takes, because a
rank resolved from a neighbour inside the write's own transaction cannot race a
concurrent writer the way a client-computed index would.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named for top-down descent | c3-0#n1@v1:sha256:533930f3ab44e0288af3d70362ad58920bf69e1ac573c89db53a58c98b5bf487 | N.A - ancestor named for top-down descent |
| c3-1 | container | N.A - ancestor named for top-down descent; the delta is in c3-104 | c3-1#n7151@v1:sha256:948fe603f61dc036b5c596dc09fe3ce3f3d30dc90f024c85f3c82db2ccab679d | N.A - ancestor named for top-down descent |
| c3-2 | container | N.A - ancestor named for top-down descent; the delta is in c3-208 and c3-215 | c3-2#n7865@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | N.A - ancestor named for top-down descent |
| c3-208 | component | Gains `board.column.update` / `move` / `delete`, and `board.sync.status` now answers with routing and a detected repo rather than just the binding | c3-208#n8278@v1:sha256:844f303a1dc89a3fb56db4e575721a405353084678086a7abfeda0736c23c284 | Confirm the enriched status is derived per read and stores nothing, so it cannot go stale |
| c3-215 | component | `readOriginRepoSlug` is added beside the existing GitHub remote parsing it reuses | c3-215#n8635@v1:sha256:4c543ddead189f1e6941d5273f5b8d278d9fb187f7f86696497a595ae85f9636 | Confirm no second remote-URL parser was introduced |
| c3-104 | component | The board pane gains the sync panel and the column popover, both as asides over the columns | c3-104#n7346@v1:sha256:a9d4107c7a4aea59659b92cf3141fe1740f7c9602f99911c614123bdcd1f2395 | Confirm one aside is open at a time, so neither hides the board being decided about |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-cqrs-read-models | `BoardSyncStatus` is a derived view assembled per read, not persisted state | ref-cqrs-read-models#n9985@v1:sha256:cc9d478fbc03fb946ec0feaf95b2e7bb2d9a0be5222850d04c8b5410718e9369 | comply — routing is recomputed from the board's columns on every status read, so it cannot disagree with the engine even briefly |
| ref-ws-subscription | Four new commands ride the existing socket | ref-ws-subscription#n10221@v1:sha256:262446a7d1764e15397e60f10d9b4c55fae08bc956461d99a6bf0e2c5c62eada | comply — request/ack only; column writes reach other clients through the registry's existing `board` snapshot push |
| ref-zustand-store | Three new client stores (sync panel, column popover, column adder) | ref-zustand-store#n10254@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — every transition is a named action, and the popover's setters take the RAW input and narrow inside the store, so no `<select>` value is cast in a JSX attribute |
| ref-strong-typing | `ColumnSemantic` and `ColumnColorToken` are closed sets crossing the wire from a `<select>` | ref-strong-typing#n10155@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — `isColumnSemantic` / `isColumnColorToken` narrow at the store boundary; an unrecognised value becomes null rather than reaching the command |
| ref-colocated-bun-test | Every module added here is client or shared code under the colocated-test convention | ref-colocated-bun-test#n9952@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply — `repo-slug.test.ts`, `BoardSyncPanel.test.tsx`, `ColumnSettings.test.tsx`, and the extended `optimistic.test.ts` |
| ref-tool-hydration | c3-215 carries it, and `readOriginRepoSlug` reads git state that the branch panel also reads | ref-tool-hydration#n10188@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | comply — it reuses c3-215's own `extractGitHubRepoSlug` rather than parsing a remote URL a second way, so there is one definition of what a GitHub remote is |
| ref-side-effect-adapter | Detecting the repo shells out to git | ref-side-effect-adapter#n10118@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply — `readOriginRepoSlug` lives in `diff-store-git-branch.adapter.ts` beside the parser it reuses; the router receives it as an injected `suggestSyncRepo` dep |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | The column popover's draft and the adder's field are store state read back through named actions | rule-zustand-store#n10380@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — `bunx ast-grep test` and `bun run lint:usestate` both pass, which is what catches an inline updater in a JSX attribute |
| rule-strong-typing | The routing rule is now a shared function two layers depend on | rule-strong-typing#n10348@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — `columnForRemoteState` takes the closed `"open" \| "closed"` union, so a third tracker state cannot be passed without widening the type |
| rule-colocated-bun-test | c3-208's new commands and c3-104's new panels both carry it | rule-colocated-bun-test#n10287@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply — see Enforcement Surfaces |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| `board-sync.test.ts` | Unchanged and still green after the private routing helpers were deleted — the proof that the shared function is the same rule, not a rewrite of it | 31 tests |
| `BoardSyncPanel.test.tsx` | Asserts a bound board shows its binding rather than the suggestion, that routing renders with no control writing it, that an unmapped board warns without disabling save, and that a non-repository is refused before anything is sent | 7 tests |
| `repo-slug.test.ts` | Pins the paste forms accepted and the ones refused outright | 2 tests |
| `ColumnSettings.test.tsx` | Asserts the role picker names behaviour, that an empty name cannot save, that a non-positive WIP value means none, and that dismissing discards the draft | 9 tests |
| `optimistic.test.ts` | Pins `resolveColumnMove` index → neighbour, including the no-op drop, and that the optimistic reorder never invents state | 15 tests total |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Wire up `column_mapping` as a real per-column mapping | Two mechanisms for "where does this card go" that can disagree silently, for a capability no provider adapter currently needs — GitHub Issues has one state axis, and that is what the engine consumes |
| Drop `column_mapping` from the schema | Honest, but discards a designed extension point for a migration's worth of churn; an unread table costs nothing and cannot be depended on by accident |
| Let the sync screen block until columns are marked | The first useful thing a board does is import. Blocking the import to demand configuration that a one-way pull does not need inverts the order people actually work in |
| Make every column edit optimistic | A rename or delete has a visible outcome and no urgency; an optimistic guess could only disagree with the snapshot a round-trip later. Only the drag genuinely needs to land under the cursor |
| Send the column's new index to the store | A client-computed index races every other writer on the board; naming the neighbour lets the store resolve a rank under the same transaction as the write |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Deleting a column loses cards | The store refuses while any remain; the UI disables the button before the click and says what to do instead | `ColumnSettings.test.tsx`; `BoardStoreError` code `column_not_empty` |
| A board is bound to the wrong repo because a suggestion was accepted blindly | The suggestion is only offered on an UNBOUND board and is labelled as read from `origin`; a bound board shows what it is bound to | `BoardSyncPanel.test.tsx` covers both states |
| Routing silently changes when someone edits a column's role | The role picker states each role's behaviour at the point of choosing, and the sync screen shows the resulting routing | `ColumnSettings.test.tsx` asserts the behavioural copy |

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun run lint` (`--max-warnings=0`) | clean |
| `bunx ast-grep test` | 14 passed, 0 failed |
| `bun run lint:usestate` | clean |
| `bun run build:client` | built |
| `bun run test` | 5417 pass, 2 skip, 0 fail |
| `c3x check` | ok, 0 errors |
