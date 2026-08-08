---
id: adr-20260808-collapse-pane-layout-to-one-workspace
c3-seal: 31452e741b021a2a6dc19b75619432f86ec7450072e5d48ccfe2139446effc52
title: collapse-pane-layout-to-one-workspace
type: adr
goal: |-
    Stop keying the pane tree by project. `usePaneLayoutStore` holds ONE workspace
    layout for the whole app instead of `layouts[projectId]`, and ChatPage renders
    it whenever the workspace holds a tab rather than behind a `projectId ?` gate.
    Chat tabs opened from different projects then accumulate side by side in the
    same tree, which per-project keying made impossible.
status: accepted
date: "2026-08-08"
---

# Collapse the per-project pane layout into one shared workspace

## Goal

Stop keying the pane tree by project. `usePaneLayoutStore` holds ONE workspace
layout for the whole app instead of `layouts[projectId]`, and ChatPage renders
it whenever the workspace holds a tab rather than behind a `projectId ?` gate.
Chat tabs opened from different projects then accumulate side by side in the
same tree, which per-project keying made impossible.

## Context

Session tabs (adr-20260805-replace-chatpage-layout-with-pane-tree, then the
`{kind:"chat", chatId}` target) made N open chats N tabs — but only within one
project. The layout the user saw was whichever project the selected chat
belonged to, so opening a chat in project B swapped project A's whole
arrangement out, and two chats from two projects could never sit side by side.
Reported directly: "hiện tại tôi đang có 2 project A và B … panel phải hiện cả
2 A và B và được tích lũy … nhưng hiện tại nó đang lọc theo project".

Nothing about the ARRANGEMENT was ever project-shaped. A chat tab addresses its
own chatId and renders its own live transcript from `useKannaState(chatId)`; a
terminal id is a `crypto.randomUUID`, globally unique. The project key was the
one thing standing between the tree and a cross-project workspace.

## Decision

Delete the project axis rather than re-key it (a per-chat key was considered and
rejected — it would have re-broken session tabs). `PaneLayoutState.layouts:
Record<string, PaneLayout>` becomes `layout: PaneLayout` and every action drops
its leading `projectId` argument.

What a tab needs from a project it now resolves from its OWN target at render
time. `findTerminalOwner(projects, terminalId)` (pure, in `terminalLayoutStore`)
gives a terminal tab its owning project, so it renders against that project's
cwd and survives switching to another project; the reconcile effect reaps a
terminal tab only when NO project claims its id. The changes panel stays a
singleton following the active project — it renders that project's git state
and there is only one.

Persistence bumps to v2 with a migrate that DROPS the v1 `layouts` map: there is
no honest mapping from N project trees to one workspace, and ChatPage's
reconcile re-opens the tabs (only hand-made splits are lost, once).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | Owns the pane tree and its persistence; the tree is no longer per project, and the "a project id is selected" precondition is gone | c3-104#n6752@v1:sha256:a5e748e23096a91ae561362476345a4c8f8a8f0035967377e2088791f185f5f2 | ref-zustand-store stable-selector rule applies to the new s.layout selector |
| c3-102 | component | Hosts usePaneLayoutStore; its Contract row states one tree per project | c3-102#n6678@v1:sha256:0f1e0525aedada9c69be265769c0abc7a56eab1ccf9bc250546cf6a49d3ee319 | rule-zustand-store: transitions stay in the store; actions keep their derive-inside shape |
| c3-112 | component | Composes the tree in the chat route: drops the projectId argument at every call site, resolves terminal owners, and gates the render on "workspace has tabs" | c3-112#n7237@v1:sha256:89bb431e754fa1a8693b69fa0521167a524dec5a6ce38f056c97383dc0904281 | ref-cqrs-read-models: the open-project subscription set is now derived from chat tabs |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | The new usePaneLayoutStore((s) => s.layout) selector must return a stable reference or it triggers React #185; same for store.projects in ChatPage | ref-zustand-store#n9982@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | comply — both select a stored object directly, no inline fallback |
| ref-colocated-bun-test | The pure owner lookup and the migration both ship with tests beside them | ref-colocated-bun-test#n9680@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply — terminalLayoutStore.test.ts, paneLayoutStore.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | passes — the dropped argument is a compile error at every missed call site |
| bun run lint | passes with --max-warnings=0 |
| bunx ast-grep test + bun run lint:usestate | pass — no unstable selector fallback introduced |
| bun run test | 5016 tests pass, 0 fail |
| bash scripts/verify-session-tabs.sh | ORACLE-PASS — session tabs still hold under the shared workspace |
| Browser: open chat a (project A), then chat B (project B) | both chat tabs present in one workspace; neither replaces the other |
