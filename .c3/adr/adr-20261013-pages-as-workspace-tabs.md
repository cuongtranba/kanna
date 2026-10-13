---
id: adr-20261013-pages-as-workspace-tabs
c3-seal: a5c4f6b07893047aabe64b7ef5650c69b5e11fa0d8c8ae0b71652dbe184634a0
title: pages-as-workspace-tabs
type: adr
goal: Record the decision to open the top-level pages (Projects, Settings, Cron, Workflows, Boards) as tabs in the same workspace pane tab strip that holds chats, instead of replacing the workspace with a full-screen page route. A page becomes a PaneTabTarget of kind page with one tab per page kind, and every page route mounts the WorkspacePage so the workspace never unmounts when the user opens a page.
status: done
date: "2026-10-13"
---

## Goal

Record the decision to open the top-level pages (Projects, Settings, Cron, Workflows, Boards) as tabs in the same workspace pane tab strip that holds chats, instead of replacing the workspace with a full-screen page route. A page becomes a PaneTabTarget of kind page with one tab per page kind, and every page route mounts the WorkspacePage so the workspace never unmounts when the user opens a page.

## Context

Opening Settings used to navigate away from the workspace route, unmount the whole pane tree and its tabs, and lose scroll position and terminal state on return. The pane tab strip already unifies chat, changes, terminal and board tabs, so pages were the only top-level destinations living outside it. Putting a page in a tab raises three problems. First, identity: a Settings tab per section would multiply tabs, while a tab with a fixed path would forget the section. Second, routing: a page tab can be visible in a split pane while the URL belongs to another tab, so a page reading the URL (useParams, or a nested Routes with a location prop) renders the wrong thing. Third, persistence: a page tab is persisted with the layout, so a path that no longer resolves after a release must be dropped on rehydrate rather than crash the workspace.

## Decision

Pages join the SAME pane strip as chats. PaneTabTarget gains page with a PageKind and the last visited path. The tab id is page_ plus the page kind, so there is exactly one tab per page kind and opening it is idempotent, and openTab retargets an existing tab when the new target differs, which is how the single Settings tab follows the user between sections. One route table in pageTabs.ts is the only URL to page mapping, checking the stack-board route before the single-board route and treating chat routes as not pages. App.tsx mounts WorkspacePage for every page route. useRouteTabSync keeps URL and tab in step: a location change opens or refocuses the page tab keyed on location.key, the focused tab writes its path back to the URL, and closing the tab that owns the URL navigates to a fallback path. PageTabContent renders the page of the active tab only, resolving route params from the tab own path and passing them to the lazily loaded page as props, so SettingsPage, WorkflowsPage, BoardsRoutePage and StackBoardsRoutePage no longer call useParams. Normalization drops a persisted page tab whose path no longer resolves to its page kind.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | Owns the tab target union, tab identity, openTab and the repair pass that now carry the page kind | c3-104#n10420@v1:sha256:e751211079a0bfa08bbc026a27754c57d81b96fc8a88af245b774c4636a147c7 | Persisted tree parsing still narrows through the JsonValue chokepoint with no unknown or cast (ref-strong-typing); the new route table and retarget are pure and covered by colocated tests (ref-colocated-bun-test) |
| c3-110 | component | The mounted Routes now mount WorkspacePage for every page route, so the shell no longer swaps the workspace out for a page | c3-110#n10489@v1:sha256:62f1ef343eefb0c9603cf2b3e70a07cf761fbd0a975e4d54fec4d2d6718ae376 | Route table edit keeps every previously working URL resolving (route regression row) |
| c3-112 | component | Owns the WorkspacePage route component, the URL to tab sync and the page renderer supplied to the pane content registry | c3-112#n10596@v1:sha256:4aebd7aa63c0466da84eacfc82ac693a19ecb19c3f55a8646d3ddc2b6e8568d2 | The sync effect and the page renderer write to the layout store, so selectors stay reference-stable (ref-zustand-store) |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A separate app-level page strip above the workspace | Two stacked tab strips in the chat view; the pane tree already splits, reorders and persists tabs, and a second strip would duplicate all of it without being splittable |
| One tab per Settings section | Opening every section spawns a tab; one tab per page kind that remembers its last path keeps the strip short and still restores the section |
| Nested Routes with a location prop inside the page tab | Descendant routes match against the remaining pathname under the parent route, so a page tab shown beside another tab matches the wrong path; params are resolved from the tab path and passed as props instead |
| Keep hidden page tabs mounted like terminals | A hidden page keeps its window listeners and subscriptions alive; a page tab renders only while it is the active tab of its pane |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Two Settings tabs open, or Settings forgets its section | Tab id derives from the page kind alone and openTab retargets the stored path | bun test --conditions production src/client/stores/paneLayoutStore.test.ts src/client/lib/paneTree/pageTabs.test.ts |
| A persisted page tab outlives its route | normalizeTabTarget drops a page tab whose path no longer resolves to its page kind | bun test --conditions production src/client/lib/paneTree/normalize.test.ts |
| A page reads the URL of another tab | Page params travel as props resolved from the tab own path | bun test --conditions production src/client/app/SettingsPage.route.test.tsx |

## Verification

| Check | Result |
| --- | --- |
| bash /Users/cuong/.claude/skills/c3/bin/c3x.sh check | Exits ok with no new issues |
| bash /Users/cuong/.claude/skills/c3/bin/c3x.sh lookup src/client/components/panes/PageTabContent.tsx | Resolves to c3-112 |
| bun test --conditions production src/client/stores/paneLayoutStore.test.ts src/client/lib/paneTree/pageTabs.test.ts | Passes |
