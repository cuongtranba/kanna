---
id: c3-104
c3-seal: 3bcf8104bc4b00670d618fea52755efa18a4e16f3666f80626aa9ab61021fece
title: pane-layout
type: component
category: foundation
parent: c3-1
goal: 'Own the user-editable pane tree: the split/close/move/focus algebra, its per-project persistence, and the resizable renderer the chat route composes.'
uses:
    - ref-colocated-bun-test
    - ref-strong-typing
    - ref-zustand-store
---

# pane-layout

## Goal

Own the user-editable pane tree: the split/close/move/focus algebra, its per-project persistence, and the resizable renderer the chat route composes.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render the chat experience" — the arrangement layer the chat route is composed into |
| Category | feature |
| Lifecycle | Tree persists per project; panes mount and unmount as the user splits and closes |
| Replaceability | The renderer may swap resize libraries; the pure tree algebra is the stable contract |

## Purpose

Owns the pane tree as a pure data structure and the components that render it: a binary tree of split groups and leaf panes, each pane holding an ordered tab list. Owns split, close, move, focus, reorder, geometric neighbour navigation, size distribution, and repair of untrusted persisted state. Non-goals: what a tab renders (supplied by the host route through a content registry), transcript or terminal behaviour, and any server state.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A project id is selected; the chat route supplies a content registry keyed by tab kind | c3-112 |
| Input — persisted layout | Per-project tree rehydrated from local storage, repaired before use | ref-local-first-data |
| Input — content registry | Host maps each tab target kind to a renderer, so panes carry no view-model | c3-112 |
| Internal state | The tree itself plus per-pane scoped UI slices | c3-102 |
| Sizing | Sibling sizes live only in the tree; there is no parallel override map | c3-102 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | The user arranges chat, changes, and terminals into a layout they control, and it survives reload | c3-1 |
| Primary path | Split a pane → tree gains a group → renderer mounts the new pane without remounting its sibling | c3-112 |
| Alternate — tab open | Tab ids derive from their target, so opening chat or changes twice is idempotent | c3-112 |
| Alternate — close | Closing the last tab collapses the pane and its parent group cascades away | c3-112 |
| Failure — corrupt persisted tree | Repair pass drops unknown nodes, renormalizes sizes, and falls back to the default layout | ref-local-first-data |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-zustand-store | ref | Layout and per-pane state live in Zustand stores with stable selector refs | must follow | Inline ?? [] fallbacks are a render-loop hazard and are lint-gated |
| ref-strong-typing | ref | Persisted-tree parsing crosses a boundary and must not use unknown or as | must follow | Repair path narrows through the shared AnyValue + isRecord chokepoint |
| ref-colocated-bun-test | ref | Every pure module carries its test beside it | must follow | The tree algebra is covered before it is rendered |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Pure tree algebra | OUT | Split, close, move, focus, reorder, navigate and size a layout as pure functions; no DOM, no store | c3-112 | src/client/lib/paneTree |
| Layout repair | OUT | Untrusted persisted state is normalized to a valid tree, deterministically — same input yields the same recovered ids | c3-112 | src/client/lib/paneTree/normalize.ts |
| Tab identity | OUT | A tab id is derived from its target, making open idempotent and chat/changes singletons by construction | c3-112 | src/client/lib/paneTree/tabTarget.ts |
| SplitContainer | OUT | Renders the tree as nested resizable groups keyed by stable node id, so a split never remounts a sibling | c3-112 | src/client/components/panes/SplitContainer.tsx |
| Content registry | IN | Host supplies one renderer per tab kind; panes hold no view-model of their own | c3-112 | src/client/components/panes/paneContentRegistry.ts |
| Per-project layout store | OUT | Persists one tree per project and seeds from the pre-rewrite layout keys on first read | c3-102 | src/client/stores/paneLayoutStore.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Sibling remount on split | Keying a rendered group on anything but a stable node id | A terminal or transcript loses its scrollback when an unrelated pane is added | bun test src/client/components/panes/SplitContainer.test.tsx |
| Render loop from an unstable selector | A use*Store selector returning an inline ?? [] / ?? {} | React error #185, caught by the loop-check test | bun run lint:usestate + bun test src/client/components/panes/SplitContainer.loop.test.tsx |
| Layout lost on a bad persisted tree | Editing the repair pass or the persisted shape | Panes vanish or the app falls back to default on reload | bun test src/client/lib/paneTree/normalize.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/lib/paneTree/**/*.ts | pane-layout Contract | Internal algorithm detail | src/client/lib/paneTree |
| src/client/components/panes/**/*.tsx | pane-layout Contract | Presentation and markup | src/client/components/panes |
| src/client/stores/paneLayoutStore.ts | pane-layout Contract | Persistence key naming | src/client/stores/paneLayoutStore.ts |
