---
id: adr-20260811-board-owns-its-rendering
c3-seal: 883ce4f0faa9a41a43c0920e9b25ee67ac222fd6362d062740fcb689c0132b63
title: board-owns-its-rendering
type: adr
goal: |-
    Remove `react-kanban-kit` and have `KannaBoard` render the board itself, driving
    `@atlaskit/pragmatic-drag-and-drop` — the engine that package wrapped — directly.
    This is a layer removed, not a dependency swapped. It is done because the
    package's virtualizer could leave a real card invisible, and because paging has
    since made virtualization unnecessary.
status: proposed
date: "2026-08-11"
---

# The board draws itself; pragmatic-dnd is used directly

## Goal

Remove `react-kanban-kit` and have `KannaBoard` render the board itself, driving
`@atlaskit/pragmatic-drag-and-drop` — the engine that package wrapped — directly.
This is a layer removed, not a dependency swapped. It is done because the
package's virtualizer could leave a real card invisible, and because paging has
since made virtualization unnecessary.

## Context

Browser testing caught a card rendered with an inline `visibility: hidden` and
`height: 40px`. That height is virtua's ESTIMATE, not a measurement: virtua
hides an item until a `ResizeObserver` measures it, and an item measured at zero
size — while the pane was still laying out — is never revealed, because nothing
resizes afterwards to trigger a second measurement. The result is a real card,
present in the DOM, invisible on the board. On the one surface where the cards
ARE the product, that is not a cosmetic fault.

It was intermittent: it rendered correctly in one session and consistently
failed in a later one. I could not reproduce it on demand, and I should record
that I first attributed it to pre-existing code on the strength of a test I
could not later trust — two bundles were present in `dist/` and the browser's
choice was never verified. The attribution was unsupported.

An unverifiable fix for an unreproducible bug adds code and faith, not
correctness. Removing the mechanism is verifiable: with no virtualizer there is
no unmeasured-item state to get stuck in.

Two things had also changed since the package was chosen. Paging now bounds a
column to one page (30 cards, raised on demand, capped at 500 server-side), so
the DOM is bounded by the paging contract rather than by the size of the board —
which was the whole argument for virtualizing. And `docs/kanban-boards-brainstorm.md`
§10 already named this exact fallback, with the confinement designed to make it
cheap.

Affected topology: the board pane and its components (c3-104); no server, store,
protocol or sync change of any kind.

## Decision

**Render the board in `KannaBoard`, and call pragmatic-dnd directly.** Every
visible element already came from our own render props, so nothing about the
board's appearance is owed to the package; what it supplied was layout,
drag-and-drop and virtualization. Layout is a flex row of columns. Drag-and-drop
is the same engine, one call level lower. Virtualization is not replaced.

**Nothing is virtualized, and nothing needs to be.** `loadMore` moves from the
package's skeleton-visibility scroll probe to an `IntersectionObserver` on the
column's tail. The skeletons stay — they are what is honest about the cards not
yet loaded — and they are now also what asks for the next page when they scroll
into view.

**Ordering stays neighbour-based.** Pragmatic-dnd reports a target element and
the closest edge; `lib/boards/dnd.ts` turns that into "between these two cards".
That is deliberate: neighbours let the store resolve a rank inside the same
transaction as the write, so a drag cannot race another writer the way a
client-computed index would. The translation is pure and tested — including the
case worth naming, a drop that changes nothing resolving to nothing rather than
spending a round-trip and a broadcast rewriting a rank to the value it had.

**A column header is the drag handle.** Without one, a drag starting on a card
would be ambiguous between moving the card and moving the column it sits in.

**Drag state lives in a store, written only from drag callbacks.** The dragged
card and the drop indicator are in different subtrees — the card dims itself
while a sibling column draws the line — so component state would have to be
lifted anyway. One drag and one indicator at a time, so single slots cannot
drift from keyed maps.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named for top-down descent | c3-0#n1@v1:sha256:533930f3ab44e0288af3d70362ad58920bf69e1ac573c89db53a58c98b5bf487 | N.A - ancestor named for top-down descent |
| c3-1 | container | N.A - ancestor named for top-down descent; the delta is in c3-104 | c3-1#n7151@v1:sha256:948fe603f61dc036b5c596dc09fe3ce3f3d30dc90f024c85f3c82db2ccab679d | N.A - ancestor named for top-down descent |
| c3-104 | component | KannaBoard renders the board and drives the drag engine itself; react-kanban-kit is removed from the dependency set | c3-104#n7346@v1:sha256:a9d4107c7a4aea59659b92cf3141fe1740f7c9602f99911c614123bdcd1f2395 | Confirm the board's appearance is unchanged and that no server, store or protocol surface moved with it |
| c3-103 | component | src/index.css loses the block that neutralised the package's injected stylesheet | c3-103#n7299@v1:sha256:1708ee5d521409cfa22d1ebaf122de57da1e6273560e52a9aa8a4797ef1c1de8 | Confirm the column's geometry is an ordinary utility class again, with no override left behind |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | Drag state is a new client store | ref-zustand-store#n10254@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — named actions only, written from drag callbacks and never during render; selectors return booleans, so no fresh reference can reach a subscriber |
| ref-strong-typing | Drop resolution crosses from the drag engine's data bag into the board's command shapes | ref-strong-typing#n10155@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — the engine's data is read through extractClosestEdge and narrowed to the four literal edges before any of it reaches a move |
| ref-colocated-bun-test | The new pure modules sit under the colocated-test convention | ref-colocated-bun-test#n9952@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply — dnd.test.ts and columnStyle.test.ts sit beside their modules |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | c3-104 carries it and this ADR adds a store to it | rule-zustand-store#n10380@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — bunx ast-grep test and bun run lint:usestate pass, which is what catches an inline updater in a JSX attribute |
| rule-strong-typing | The board's props are the seam the removed package used to sit behind | rule-strong-typing#n10348@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — KannaBoardProps is unchanged by this ADR, which is the evidence the swap did not leak past the component |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| lib/boards/dnd.test.ts | Pins edge → insertion point and insertion point → neighbours, including the no-op drop and the dragged card being excluded from its own neighbours | 10 tests |
| lib/boards/columnStyle.test.ts | Asserts every colour token in the closed set has a LITERAL Tailwind class — an interpolated one is never emitted, so a missing row renders a transparent dot rather than failing | 2 tests |
| lib/boards/optimistic.test.ts | The optimistic reorder is unchanged; resolveColumnMove is deleted with the index-based API it served | 13 tests |
| Real browser | Zero elements with an inline visibility: hidden anywhere on the page; a real HTML5 drag reorders two cards and the new fractional rank is read back out of SQLite | measured, not asserted |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the package, pass virtualization={false} | Its non-virtualized renderer builds Array.from({length: totalChildrenCount}) — a 5000-issue column becomes 5000 DOM nodes at once, which is worse than the bug |
| Force visibility: visible with scoped CSS | Needs !important to beat an inline style, aimed at the internal DOM of a 0.0.2-beta.7 package, and would also defeat the virtualizer's hiding of genuinely offscreen rows |
| Only mount the board once its container has a size | Addresses the likely trigger, but the bug does not reproduce on demand, so the fix could not be shown to work — faith, not correctness |
| Wait for it to recur and capture it | Leaves a known way for a real card to be invisible in the shipped product while we watch for it |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A very large column renders too many nodes | Paging bounds a column to one page, raised on demand, capped at 500 per column server-side — so the ceiling is 500 rather than the board's size | ws-router-envelope.test.ts pins the cap; boardsStore.test.ts pins that an exhausted board stops growing |
| Hand-rolled drag-and-drop behaves worse than the package's | The engine is the same one the package used; only the layer above it changed | A real HTML5 drag reorders and persists, measured in the browser |
| Drag-and-drop is not covered by an automated test | Accepted and stated: the harness cannot drive native HTML5 drag through synthetic mouse events. The pure half — every ordering decision — IS covered; the wiring was verified by hand | dnd.test.ts for the decisions; browser evidence for the wiring |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bunx ast-grep test | 14 passed, 0 failed |
| bun run lint:usestate | clean |
| bun run build:client | built |
| bun run test | 5435 pass, 2 skip, 0 fail |
| Browser: inline visibility: hidden count | 0 |
| Browser: drag two cards, read the rank back from SQLite | reordered and persisted |
