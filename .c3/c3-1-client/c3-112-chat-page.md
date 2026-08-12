---
id: c3-112
c3-version: 4
c3-seal: 59e1fb0221cefc78eea384e66e110cdfce18de25c95d550880709a22006f51c4
title: chat-page
type: component
category: feature
parent: c3-1
goal: 'Compose the workspace route that both /chat/:chatId and /boards/:projectId/:boardId mount: transcript viewport, input dock, terminal workspace, focus policy, sidebar actions, and the presentation context every open tab is titled from.'
uses:
    - ref-cqrs-read-models
    - ref-ws-subscription
---

# chat-page

## Goal

Compose the workspace route that both /chat/:chatId and /boards/:projectId/:boardId mount: transcript viewport, input dock, terminal workspace, focus policy, sidebar actions, and the presentation context every open tab is titled from.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render hydrated transcripts… Accept user input: chat composer" |
| Category | feature |
| Lifecycle | Mounts on /chat/:chatId and on /boards/:projectId/:boardId; the route param opens a tab rather than deciding what the page is, and the page renders whenever the workspace has tabs |
| Replaceability | Composition can be reshaped; sub-components remain stable |

## Purpose

Composes the workspace route: transcript viewport, input dock, embedded terminal panel, focus/scroll policy, sidebar action wiring, and the pure context the tab strip titles and statuses tabs from. Route-neutral — /chat/:chatId and /boards/:projectId/:boardId mount the same page and differ only in which tab the route param opens. Non-goals: rendering individual entries, owning input state, terminal PTY logic, and what a non-chat tab renders.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | App-shell mounted and useKannaState returns chat snapshot for sessionId | c3-110 |
| Input — transcript renderer | Receives entries, dispatches per-kind | c3-113 |
| Input — chat UI chrome | Composer, pickers, attachments | c3-115 |
| Input — terminal workspace | Terminals render inside a pane as a tab, supplied through the content registry rather than a fixed panel | c3-118 |
| Internal state | Focus policy state, panel sizes, scroll anchor | c3-102 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Single workspace where user reads agent output and replies | c3-1 |
| Primary path | Subscribe chatView → render transcript + composer → send command | ref-ws-subscription |
| Alternate — terminal toggle | Keybinding opens a terminal as a tab; the user may split it beside the transcript or the changes view | c3-104 |
| Alternate — sticky focus | Focus policy keeps last-read entry visible during streaming | c3-112 |
| Failure — session not found | Display banner; allow back-to-projects | c3-117 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Subscribe to per-session chatView | must follow | One subscription per chat-page mount |
| ref-cqrs-read-models | ref | Render only snapshot projections | must follow | No event-log reads |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <WorkspacePage> route component | OUT | One page mounted at both /chat/:chatId and /boards/:projectId/:boardId; the route param opens its tab and the render gate is whether the workspace has tabs, so neither route is privileged and neither needs a chat to exist | c3-110 | src/client/app/ChatPage/index.tsx |
| Pane arrangement | OUT | Arrangement is a user-editable pane tree, not a fixed slot order; the route composes the tree and supplies one renderer per tab kind | c3-104 | src/client/app/ChatPage/index.tsx |
| Focus policy callback | IN | Hooks consumed for sticky scroll | c3-112 | src/client/app/useStickyChatFocus.ts |
| Tab presentation context | OUT | Titles and statuses for every open tab are built as a pure function over EVERY project's snapshots, never the active project's alone, because one workspace is shared across projects; a board title is read from the open board view as well as the project's board list, so landing straight on a board address still titles its tab | c3-104 | src/client/app/ChatPage/tabPresentationContext.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Sticky focus regression | Scroll-anchor logic edit | User loses place during streaming | bun run test src/client/app/ChatPage.test.ts + manual streaming smoke |
| Layout animation jank | Toggle animation timing edit | Visible flash on terminal toggle | bun run test src/client/app/useTerminalToggleAnimation.ts adjacent tests |
| Tab falls back to its kind's label | Titling a tab from the active project's snapshots, or a board from the project's board list alone | A board opened by URL reads "Board"; a chat or terminal tab reads its fallback after the user changes project | bun test --conditions production src/client/app/ChatPage/tabPresentationContext.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/ChatPage/**/*.tsx | c3-112 Contract | Internal layout shape | src/client/app/ChatPage |
| src/client/app/useStickyChatFocus.ts | c3-112 Contract | Hook detail | src/client/app/useStickyChatFocus.ts |
