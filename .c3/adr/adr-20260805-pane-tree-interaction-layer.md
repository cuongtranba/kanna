---
id: adr-20260805-pane-tree-interaction-layer
c3-seal: 23cf4debdb594830609796123c8448fcc3c80d7bb2ebd0a67ec5f0a89181e945
title: pane-tree-interaction-layer
type: adr
goal: 'Finish the pane-layout component by adding the four interaction capabilities the initial rewrite deliberately deferred: keeping backgrounded tabs alive instead of unmounting them, collapsing the tree to a single tab-bearing pane on a phone, driving the layout entirely from rebindable keys, and moving tabs between panes by dragging. Each is a policy decision with a real failure mode, so each lands as a pure, separately-tested module that the components consume.'
status: accepted
date: "2026-08-05"
---

# Complete the pane tree's interaction layer: retention, phone view, keyboard, drag-and-drop

## Goal

Finish the pane-layout component by adding the four interaction capabilities the initial rewrite deliberately deferred: keeping backgrounded tabs alive instead of unmounting them, collapsing the tree to a single tab-bearing pane on a phone, driving the layout entirely from rebindable keys, and moving tabs between panes by dragging. Each is a policy decision with a real failure mode, so each lands as a pure, separately-tested module that the components consume.

## Context

The pane tree shipped able to render, split, resize and close, but a pane rendered ONLY its active tab. Switching tabs unmounted the previous one, destroying state the app cannot rebuild: a terminal's PTY-backed scrollback, a transcript's scroll offset, an expanded tool group. That made a split with a terminal in it actively worse than the layout it replaced.

Three further gaps followed from the same "render the focused thing" shape. Below the md breakpoint the full tree rendered, so a two-way split left each pane too narrow to read — and because layouts persist per project, a tree split on a desktop and reopened on a phone would have hidden tabs with no way to reach them. The layout had no keyboard surface at all. And a tab could only be placed by the split buttons, never moved between existing panes.

Constraints: client state lives in Zustand stores whose selectors must return reference-stable values; `useState` is unavailable outside `components/ui/**`; the design gate forbids `backdrop-blur` and raw hex; every pure module carries a colocated Bun test.

## Decision

Put each policy in a pure module and keep the components as thin adapters.

**Retention is three-tier, and terminals are uncapped.** The active tab always stays; terminal tabs always stay, without limit, because a terminal owns a live process the server cannot replay; everything else is kept by recency up to a cap. Hidden tabs use `visibility:hidden`, never `display:none` — the latter collapses the layout box, which discards scroll offsets and makes xterm remeasure to zero — plus `inert`, so a hidden subtree leaves the focus and accessibility trees. The recency cap cannot bind with today's three tab kinds, since chat and changes are singletons; it is enforced ahead of need so that adding a non-singleton kind later cannot silently retain unbounded live subtrees.

**The phone view flattens rather than filters.** Rendering only the focused pane would strand every tab in the others. Instead all tabs are gathered, in tree order, into one pane that keeps the focused pane's identity — so pane-addressed state stays coherent and the layout-wide select and close operations keep working untouched. It reads like a mobile browser: one viewport, many tabs.

**One dispatcher, one pure mapper.** Nine new rebindable actions resolve through `resolvePaneCommand`, which ChatPage's existing single keydown listener consults; each command's subject is derived inside the store. The typing guard suppresses only MODIFIER-LESS bindings: every default is a modifier combo and a terminal or the composer holds focus most of the time, so blanket suppression would make pane navigation unreachable from exactly where it is needed.

**Drop position is geometry, not a hit-list.** The middle 40% of both axes merges; everything else splits toward the proportionally nearest edge, so no part of a pane is dead during a drag. Proportional rather than pixel distance is what stops a wide, short pane from answering "top" almost everywhere.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | Gains four contract surfaces — tab retention, the phone flatten, the keyboard command mapper, and drop geometry — none of which existed when the component was created | c3-104#n6659@v1:sha256:4749384938d606f238c496de4be8717fb188506c2c11524bc3dc9337419164fb | Selector reference stability under continuous drag events; no display:none for hidden panes |
| c3-102 | component | Gains the transient tab-drag store | c3-102#n6559@v1:sha256:0f1e0525aedada9c69be265769c0abc7a56eab1ccf9bc250546cf6a49d3ee319 | Guarded writes so a drag does not publish a snapshot per pixel |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | The drag store is written on every pointer move during a drag, and the retention selector is read by every pane — an unguarded write or an unstable selector would re-render the whole tree continuously | ref-zustand-store#n9414@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply |
| ref-colocated-bun-test | Each of the four policies is a pure module written test-first, with its test beside it | ref-colocated-bun-test#n9112@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hide backgrounded tabs with display:none | It collapses the layout box, so scroll offsets are discarded and xterm remeasures to zero on every tab switch — the same class of state loss retention exists to prevent. |
| Cap retention by count only, with no terminal exemption | A user with four terminals would lose the scrollback of the oldest whenever they visited a fifth tab. A terminal's state is not reconstructible, so it cannot participate in an LRU. |
| Render only the focused pane on a phone | Layouts persist per project, so a tree split on a desktop and reopened on a phone would hide tabs with no route back to them. |
| Suppress all pane keybindings while an input or terminal has focus | A terminal or the composer holds focus almost all the time, so pane navigation would be unreachable from exactly the place it is needed. Only modifier-less rebinds are suppressed. |
| Give tabs a keyboard drag via dnd-kit's KeyboardSensor | The pane keybindings already reach every outcome a drag can produce — split, close, cycle, focus a direction — without a mouse, so a keyboard drag would be a second way to do the same thing. |
| Reuse the sidebar's sortable list for tabs | Sortable models a one-dimensional reorder. A tab drop is two-dimensional: it must distinguish merging into a pane from splitting it along one of four edges. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A drag re-renders every pane on each pointer move | Every drag-store write is guarded on value, returning the identical state object when nothing changed | bun test src/client/components/panes/SplitContainer.drop.test.tsx |
| Retention holds unbounded live subtrees as tab kinds grow | Tier 3 enforces a recency cap now, before a non-singleton kind exists to exercise it | bun test src/client/components/panes/paneRetention.test.ts |
| A new pane keybinding collides with a browser or sidebar shortcut | Defaults avoid cmd+alt (the sidebar hint modifier) and the browser-reserved ctrl+shift and cmd+w families; the reasoning is recorded beside DEFAULT_KEYBINDINGS | bun test src/client/components/panes/paneKeyboard.test.ts |
| The phone view strands tabs | The tree is flattened, not filtered, and a test asserts every tab reaches the single strip | bun test src/client/components/panes/mobileLayout.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run verify:client-arch (ast-grep + lint + typecheck + full suite) | Passes — 4790 pass, 2 skip, 0 fail |
| bun run build:client | Builds; dnd-kit resolves from devDependencies through Vite as the sidebar's drag already does |
| bun test src/client/components/panes/ | 112 pass — the four pure policies plus their component wiring |
| c3x check | c3-104 and c3-102 valid against their canvas after this unit applies |
