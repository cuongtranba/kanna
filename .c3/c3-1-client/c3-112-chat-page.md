---
id: c3-112
c3-version: 4
c3-seal: 326051bba83d0f6c69d8165e9efcb46c0275a257f4bf04572dacf0d29a9636f8
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
| <WorkspacePage> route component | OUT | One page mounted at /chat/:chatId, /boards/:projectId/:boardId and every top-level page route (/, /settings/:sectionId, /cron, /workflows/:chatId, /boards/:projectId, /boards/stack/:stackId); the route opens its tab and the render gate is whether the workspace has tabs, so no route is privileged and none needs a chat to exist | c3-110 | src/client/app/ChatPage/index.tsx |
| Pane arrangement | OUT | Arrangement is a user-editable pane tree, not a fixed slot order; the route composes the tree and supplies one renderer per tab kind | c3-104 | src/client/app/ChatPage/index.tsx |
| Focus policy callback | IN | Hooks consumed for sticky scroll | c3-112 | src/client/app/useStickyChatFocus.ts |
| Tab presentation context | OUT | Titles and statuses for every open tab are built as a pure function over EVERY project's snapshots, never the active project's alone, because one workspace is shared across projects; a board title is read from the open board view as well as the project's board list, so landing straight on a board address still titles its tab | c3-104 | src/client/app/ChatPage/tabPresentationContext.ts |
| Tab switching keys | OUT | Alt+backtick opens a recent-tabs switcher over EVERY pane, ordered by recorded focus rather than position, and commits when the held modifier is released; the jump modifier plus a digit focuses that position in the focused pane, 9 meaning the last tab; both keys are claimed in the capture phase so a focused terminal never receives them | c3-104 | src/client/hooks/useTabSwitcherHotkeys.ts |
| URL and tab sync | OUT | useRouteTabSync opens or refocuses the page tab for the current URL, keyed on location.key so re-clicking Settings refocuses its tab even at the same path; a page route opens its page tab and never a chat tab, even on /workflows/:chatId. In the other direction the focused tab writes its address to the URL: a chat to /chat/id and a page to its path, while board, terminal and changes tabs leave the URL alone. Closing the tab that owns the URL navigates to fallbackPathAfterClose | c3-104 | src/client/app/ChatPage/useRouteTabSync.ts |
| Page tab renderer | OUT | WorkspacePage supplies the page renderer of the content registry through PageTabContent, which loads each page lazily and resolves its route params from the tab own path, passing them as props because a page tab can be visible in a split pane while the URL belongs to another tab. It renders only while it is the active tab of its pane | c3-104 | src/client/components/panes/PageTabContent.tsx |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Sticky focus regression | Scroll-anchor logic edit | User loses place during streaming | bun run test src/client/app/ChatPage.test.ts + manual streaming smoke |
| Tab falls back to its kind's label | Titling a tab from the active project's snapshots, or a board from the project's board list alone | A board opened by URL reads "Board"; a chat or terminal tab reads its fallback after the user changes project | bun test --conditions production src/client/app/ChatPage/tabPresentationContext.test.ts |
| Switch key leaks into the terminal | Moving the tab-switch listener off the window capture phase | The shell receives ESC-backtick while the tab changes | bun test --conditions production src/client/components/panes/TabSwitcher.test.tsx |
| Page tab shows another tab page | A page reading useParams, or a nested Routes with a location prop, instead of props resolved from the tab own path | A Settings or Workflows tab in a split pane renders the section or chat of whichever tab owns the URL | bun test --conditions production src/client/app/SettingsPage.route.test.tsx src/client/app/ChatPage/ChatPage.tabs.test.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/ChatPage/**/*.tsx | c3-112 Contract | Internal layout shape | src/client/app/ChatPage |
| src/client/app/useStickyChatFocus.ts | c3-112 Contract | Hook detail | src/client/app/useStickyChatFocus.ts |
