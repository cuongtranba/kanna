---
id: c3-112
c3-version: 4
c3-seal: 9b2a2cb9f80f5cea696dcf84690f1e07e1db0c9fcaba6202d01a2f4bb7cf1a21
title: chat-page
type: component
category: feature
parent: c3-1
goal: 'Compose the chat route: transcript viewport, input dock, terminal workspace, focus policy, and sidebar actions.'
uses:
    - ref-cqrs-read-models
    - ref-ws-subscription
---

# chat-page

## Goal

Compose the chat route: transcript viewport, input dock, terminal workspace, focus policy, and sidebar actions.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render hydrated transcripts… Accept user input: chat composer" |
| Category | feature |
| Lifecycle | Mounts per /chat/:sessionId route; remounts on session change |
| Replaceability | Composition can be reshaped; sub-components remain stable |

## Purpose

Composes the chat route: transcript viewport, input dock, embedded terminal panel, focus/scroll policy, sidebar action wiring. Non-goals: rendering individual entries, owning input state, terminal PTY logic.

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
| <ChatPage> route component | OUT | Mounts at /chat/:sessionId, owns layout | c3-110 | src/client/app/ChatPage |
| Pane arrangement | OUT | Arrangement is a user-editable pane tree, not a fixed slot order; the route composes the tree and supplies one renderer per tab kind | c3-104 | src/client/app/ChatPage/index.tsx |
| Focus policy callback | IN | Hooks consumed for sticky scroll | c3-112 | src/client/app/useStickyChatFocus.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Sticky focus regression | Scroll-anchor logic edit | User loses place during streaming | bun run test src/client/app/ChatPage.test.ts + manual streaming smoke |
| Layout animation jank | Toggle animation timing edit | Visible flash on terminal toggle | bun run test src/client/app/useTerminalToggleAnimation.ts adjacent tests |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/ChatPage/**/*.tsx | c3-112 Contract | Internal layout shape | src/client/app/ChatPage |
| src/client/app/useStickyChatFocus.ts | c3-112 Contract | Hook detail | src/client/app/useStickyChatFocus.ts |
