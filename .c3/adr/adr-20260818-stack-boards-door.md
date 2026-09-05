---
id: adr-20260818-stack-boards-door
c3-seal: d59ffd5b484da03c19288c9e91677995153f7c5d2c795342be06d77750c681c0
title: stack-boards-door
type: adr
goal: |-
    Give `BoardOwnerKind: "stack"` a UI door: routes `/boards/stack/:stackId` and
    `/boards/stack/:stackId/:boardId`, a `BoardsPage` that takes `ownerKind` /
    `ownerId` instead of hardcoding `"project"`, and a Boards affordance on a
    Stack's sidebar row — closing out issue #759 (`boards: give ownerKind "stack"
    a door (routes + sidebar + BoardsPage)`).
status: done
date: "2026-08-18"
---

# stack-boards-door

## Goal

Give `BoardOwnerKind: "stack"` a UI door: routes `/boards/stack/:stackId` and
`/boards/stack/:stackId/:boardId`, a `BoardsPage` that takes `ownerKind` /
`ownerId` instead of hardcoding `"project"`, and a Boards affordance on a
Stack's sidebar row — closing out issue #759 (`boards: give ownerKind "stack"
a door (routes + sidebar + BoardsPage)`).

## Context

`BoardOwnerKind = "project" | "stack"` (`src/shared/boards/types.ts`) has been
in the domain, the SQLite store (`board-store.adapter.ts`), the registry
(`board-registry.ts`), and the WS command layer (`ws-router-boards.ts`) since
those were authored — none of them special-case `ownerKind`, so a Stack-owned
board already persists, broadcasts, and reconciles correctly. `Card.projectId`
exists specifically for this case, and `BoardPane.tsx` already branches on
`view.board.ownerKind === "project"` before offering its "back to the boards
list" breadcrumb — the server and the board pane were both already carrying a
Stack case that had no way to be reached.

What was missing was the door: every client call site hardcoded
`ownerKind: "project"` (`BoardsPage.tsx`, `BoardsRoutePage.tsx`), the only
routes were `/boards/:projectId` and `/boards/:projectId/:boardId`
(`App.tsx`), and the Stack row in the sidebar (`StacksSection.tsx`) had no
Boards action — only the project row did, via `ProjectSectionMenu` in
`Menus.tsx`.

## Decision

**`BoardsPage` takes `ownerKind` / `ownerId` / `ownerName`, not a hardcoded
`"project"` + `projectId` + `projectName`.** The component was already
owner-agnostic in spirit — it forwarded whatever ownerKind it was given to the
board topic subscription's key — but the prop names and the literal
`"project"` in `ownerKey("project", projectId)` and the `board.create` command
lied about that. Renaming the props to their real shape means a Stack owner
and a project owner are now the same code path, not a second one.

**Two new routes, ordered so segment count cannot disambiguate them but the
literal `"stack"` segment does.** `/boards/stack/:stackId` (list) and
`/boards/stack/:stackId/:boardId` (opens into the workspace, exactly like a
project board) sit beside the existing `/boards/:projectId` and
`/boards/:projectId/:boardId`. react-router scores a literal path segment
above a dynamic one at the same position, so `/boards/stack/abc` resolves to
the Stack list and never gets read as `:projectId="stack"` — pinned by a
dedicated route-disambiguation test (`boardsRoutes.test.tsx`) that exercises
the real four-route `<Routes>` shape rather than trusting the scoring by
inspection. `WorkspacePage` needed no change: it already reads only
`boardId` via `useParams`, route-neutral by design (see its own docstring),
so the same tab-opening effect fires for either address.

**A new `StackBoardsRoutePage`, not a `BoardsRoutePage` prop.** The two route
pages resolve their owner's name differently (a project group's local path
basename vs. a Stack's own title from `sidebarData.stacks`) and navigate to
different addresses on open. Branching one component on `ownerKind` would
make it read both owners' resolution logic to understand either one; two thin
route pages that both render the same `BoardsPage` keep each concern legible
on its own.

**The Stack row's Boards affordance mirrors the project row's exactly.**
`StackActionsPopover` and `StackSectionMenu` (`Menus.tsx`) both gained the
same optional `onOpenBoards` prop, in the same position (first item, followed
by a separator) as `ProjectSectionMenu` already has it — one visual
vocabulary for "this is the item that navigates" across both owner kinds.
`KannaSidebar.handleOpenStackBoards` mirrors the existing
`handleOpenBoards`, one owner kind over.

**First-run empty-state copy is generalized.** "No boards in this project
yet." became "No boards yet." — the only owner-specific string in
`BoardsPage`'s template picker, and a Stack has no single project the old
copy could name.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named for top-down descent | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc "${GOAL}" | N.A - ancestor named for top-down descent |
| c3-1 | container | N.A - ancestor named for top-down descent; the delta is entirely in c3-119 | c3-1#n8238@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions." | N.A - ancestor named for top-down descent |
| c3-119 | component | BoardsPage retyped to ownerKind/ownerId/ownerName; two new routes (StackBoardsRoutePage, App.tsx); Stack row gains a Boards affordance (StacksSection.tsx, Menus.tsx, KannaSidebar.tsx) | c3-119#n9144@v1:sha256:bb7f19f0db4cf78edca49db644d9708151fc6f2387fdef83b2eb74b168248e15 "Board tab \| OUT \| /boards/:projectId/:boardId and /boards/stack/:stackId/:boardId both mount the same route-neutral workspace page a chat does and open a board tab \| c3-112 \| src/client/app/BoardsRoutePage.tsx, src/client/app/StackBoardsRoutePage.tsx" | Confirm no ownerKind: "project" literal remains in a call site that should be owner-agnostic, and that the Stack routes cannot be reached via a project id |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | BoardsPageProps.ownerKind is typed BoardOwnerKind, the existing closed union — not widened to string | ref-strong-typing#n11564@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply — the prop is threaded verbatim through ownerKey, the subscription topic, and the board.create command with no re-typing |
| ref-ws-subscription | Cited by c3-119 generally | ref-ws-subscription#n11630@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | N.A - this change adds no new subscription; the existing boards topic subscribe is unchanged, only the ownerKind/ownerId it is keyed on |
| ref-zustand-store | Cited by c3-119 generally | ref-zustand-store#n11663@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | N.A - no new store transition is introduced; handleOpenStackBoards is a plain navigate() call, not a state update |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Every changed or new module (BoardsPage.tsx, StackBoardsRoutePage.tsx, StacksSection.tsx, Menus.tsx, KannaSidebar.tsx) carries a sibling test | rule-colocated-bun-test#n11696@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply — see Enforcement Surfaces |
| rule-zustand-store | Cited by c3-119 generally | rule-zustand-store#n11789@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | N.A - no store transition is introduced by this change |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/client/components/boards/BoardsPage.tsx | projectId/projectName → ownerKind/ownerId/ownerName; subscription topic, ownerKey, and board.create all read the prop instead of the literal "project"; empty-state copy generalized | diff |
| src/client/app/BoardsRoutePage.tsx | Passes ownerKind="project" explicitly at the one project call site | diff |
| src/client/app/StackBoardsRoutePage.tsx | New route page for /boards/stack/:stackId, mirroring BoardsRoutePage | new file |
| src/client/app/App.tsx | Adds /boards/stack/:stackId and /boards/stack/:stackId/:boardId | diff |
| src/client/components/chat-ui/sidebar/Menus.tsx | StackActionsPopover and StackSectionMenu gain an optional onOpenBoards | diff |
| src/client/components/chat-ui/sidebar/StacksSection.tsx | Forwards onOpenBoards to both menu variants | diff |
| src/client/app/KannaSidebar.tsx | handleOpenStackBoards navigates to /boards/stack/:stackId, wired into StacksSection | diff |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| BoardsPage.test.tsx (new) | Asserts the subscription topic, the board.create command, and the rendered header name all carry the owner the page was given, for both "stack" and "project" | 4 tests |
| StackBoardsRoutePage.test.tsx (new) | Lists a Stack's boards under its own title and opening one navigates to /boards/stack/:stackId/:boardId with no chat or tab created | 3 tests |
| boardsRoutes.test.tsx (new) | Exercises the real four-route <Routes> shape; pins that the Stack routes resolve to the Stack list / workspace and never to the project list | 4 tests |
| Menus.stack.test.tsx | Extended: StackActionsPopover and StackSectionMenu both render with onOpenBoards present or omitted | 4 new tests |
| StacksSection.test.tsx | Extended: renders without throwing with onOpenBoards + onDeleteStack both set, and with onOpenBoards omitted | 2 new tests |
| KannaSidebar.test.tsx | Extended: a Stack row's actions menu renders without throwing now that it carries the Boards item | 1 new test |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Branch BoardsRoutePage on a stack?: boolean param instead of a new route page | Two different owner-name resolution paths and two different open-navigation targets living in one component reads worse than two thin pages each doing one thing |
| Give /boards/stack/:stackId/:boardId its own workspace variant | WorkspacePage is already route-neutral (reads only boardId); adding a second workspace component would duplicate the tab-opening effect for no behavioural difference |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bun run lint:usestate | clean |
| bunx ast-grep test | 15 passed, 0 failed |
| bun run test | 6533 pass, 2 skip, 0 fail |
