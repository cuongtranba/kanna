---
id: adr-20260805-replace-chatpage-layout-with-pane-tree
c3-seal: f4b2f06cb658c2005540105b70c02d96dfbe8592cfa4ed1628511caa64257c22
title: replace-chatpage-layout-with-pane-tree
type: adr
goal: Replace the chat route's hard-coded layout — a fixed slot order of sidebar, transcript, composer, and a toggled terminal panel — with a persisted, user-editable pane tree. The tree is a binary structure of split groups and leaf panes; each pane holds an ordered tab list, and what a tab renders is supplied by the host route through a content registry rather than baked into the layout. This ADR authorizes the new arrangement layer as its own component and records the resulting contract change on the chat route and the client state stores.
status: accepted
date: "2026-08-05"
---

# Replace the chat route's fixed layout with a user-editable pane tree

## Goal

Replace the chat route's hard-coded layout — a fixed slot order of sidebar, transcript, composer, and a toggled terminal panel — with a persisted, user-editable pane tree. The tree is a binary structure of split groups and leaf panes; each pane holds an ordered tab list, and what a tab renders is supplied by the host route through a content registry rather than baked into the layout. This ADR authorizes the new arrangement layer as its own component and records the resulting contract change on the chat route and the client state stores.

## Context

`ChatPage` composed its layout by hand: a `ChatWorkspace` wrapper plus `DesktopSidebarPane` / `MobileSidebarPane`, wired by a 19-prop drill and a 28-prop memoized props object. The slot order was fixed, so the only user control was toggling the right sidebar and the terminal panel. A user could not put changes beside a terminal, could not open two terminals in different regions, and nothing about the arrangement survived a reload beyond two coarse booleans and a width.

The layout also carried a live remount bug: the terminal grid keyed its panel group on `terminalIds.join(":")`, so adding a third terminal changed the key and tore down and rebuilt the xterm instances of the first two, losing their scrollback.

Constraints that shaped the work: client state must live in Zustand stores whose selectors return reference-stable values (an inline `?? []` triggers React error #185, and the repo lint-gates the shape); values crossing the persisted-state boundary may not use `unknown` or `as`, and must narrow through the shared `AnyValue` + `isRecord` chokepoint; every pure module carries a colocated Bun test. The chat transcript remains a declared singleton — exactly one is ever live — so per-pane transcript state was explicitly out of scope.

## Decision

Model the arrangement as a **pure tree algebra in its own component** (c3-104, pane-layout), and let the chat route compose it rather than own it.

Three choices are load-bearing and differ from the obvious implementation:

1. **Tab ids derive from their target.** An id is a function of what the tab points at, so "open chat" is idempotent by construction — chat and changes are singletons because the id collides, not because a guard checks a list. This is what keeps the multi-transcript problem structurally impossible rather than merely forbidden.
2. **Sibling sizes live only in the tree.** There is no parallel override map beside the tree; the resize path writes the tree itself. A second map would leak entries for deleted groups and leave the in-tree writer dead.
3. **Panes hold no view-model.** The host supplies one renderer per tab kind through a content registry, which is what dissolves the 19-prop drill and lets the pure algebra stay DOM-free and fully testable before anything renders.

The renderer keys nested resizable groups on stable node ids, which retires the `terminalIds.join(":")` remount bug as a side effect. Persisted trees are untrusted input and pass through a deterministic repair pass — the same input recovers the same ids, so React keys do not churn across reads.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | New component: owns the tree algebra, its persistence, and the resizable renderer | c3-104#n9609@v1:sha256:e8c6880f6b062863b0489258deb99d40ac30605990780405bd0ea4e5e801f945 | Zustand selector stability, strong typing at the persisted boundary, colocated tests |
| c3-112 | component | Its Contract still claims a fixed sidebar → transcript → composer → terminal slot order, which the pane tree replaces; the terminal is now a tab, not a toggled panel | c3-112#n6709@v1:sha256:10792d64433e0f0bc5f65036758e4d80e062bfe63dc7e8de912cb07c92befbb0 | Chat route no longer owns arrangement; confirm it only composes |
| c3-102 | component | Gains the per-project pane layout store and the per-pane scoped store factory | c3-102#n6509@v1:sha256:2df708c7835fc05f0843c7446f178056f0f7bdd54946823b2bd751496a018431 | Selector reference stability; persistence key naming |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | The layout store and the per-pane scoped slices are new client state, and an unstable selector here would loop the whole chat route | ref-zustand-store#n9414@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply |
| ref-strong-typing | The persisted tree is untrusted input crossing a boundary; unknown and as are banned, so the repair pass narrows through the shared chokepoint | ref-strong-typing#n9315@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |
| ref-colocated-bun-test | The tree algebra was written test-first and each pure module carries its test beside it | ref-colocated-bun-test#n9112@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the fixed slot order and add a third toggleable region | Does not compose: every new region multiplies the prop drill and the boolean visibility state, which is exactly what made the 28-prop memo unmaintainable. It also cannot express "changes beside a terminal". |
| Keep a parallel size-override map beside the tree, as the design this was adapted from does | Its resize action writes the map instead of the tree, leaving the in-tree size writer dead and leaking entries for groups that no longer exist. Sizes in the tree have one writer and are garbage-collected with their group. |
| Store a tabIds list on the pane and bridge to a runtime field | The bridge requires as casts at the boundary, which the repo bans outright. Tabs live on the pane directly. |
| Give each pane its own transcript state provider | Out of scope by design — chat is a declared singleton tab, so only one transcript is ever live. A per-pane provider would invite the multi-transcript problem the derived tab ids exist to prevent. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A split remounts an unrelated pane, destroying terminal scrollback | Rendered groups key on stable tree node ids, never on a derived join of child ids | bun test src/client/components/panes/SplitContainer.test.tsx |
| An unstable store selector loops the chat route (React #185) | Stable EMPTY refs and useShallow; the repo's ast-grep rules gate the shape | bun run lint:usestate + bun test src/client/components/panes/SplitContainer.loop.test.tsx |
| A corrupt or stale persisted tree blanks the layout | Deterministic repair pass drops unknown nodes, renormalizes sizes, falls back to the default layout, and recovers ids reproducibly | bun test src/client/lib/paneTree/normalize.test.ts |
| A user's pre-rewrite arrangement is silently flattened on upgrade | The store seeds from the previous layout keys on first read, preserving side-by-side terminals rather than collapsing them | bun test src/client/stores/paneLayoutMigration.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run verify:client-arch (ast-grep + lint + typecheck + full test suite) | Passes — 4715 pass, 2 skip, 0 fail |
| bun test src/client/lib/paneTree/ | The pure algebra is green before anything renders it |
| grep -n SplitContainer src/client/app/ChatPage/index.tsx | The chat route composes the pane tree; ChatWorkspace, DesktopSidebarPane, MobileSidebarPane no longer exist anywhere in src/ |
| c3x check | c3-104, c3-112, c3-102 valid against their canvas after this unit applies |
