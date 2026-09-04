---
id: c3-1
c3-version: 4
c3-seal: 114b9ab51f48406379982a75f638e544c0f8cbfdcc46e7ec359c21a9cace9637
title: Client
type: container
boundary: app
parent: c3-0
goal: 'Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions.'
---

# client

## Goal

Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions.

## Responsibilities

- Own the browser-side state surface (Zustand stores, React context, URL routing).
- Subscribe to server snapshots over WebSocket and diff them into the local view model.
- Render hydrated transcripts including provider-agnostic tool calls, plan-mode prompts, and diffs.
- Accept user input: chat composer, provider/model switches, settings, drag-to-reorder projects, terminal keystrokes.
- Degrade gracefully when the socket drops or auth is required.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-101 | socket-client | foundation | active | Single WS transport + typed envelope dispatch |
| c3-102 | state-stores | foundation | active | UI-local state via per-concern Zustand stores |
| c3-103 | ui-primitives | foundation | active | Radix + shadcn primitives used by every feature |
| c3-110 | app-shell | feature | active | Router, central state hook, socket wiring |
| c3-111 | sidebar | feature | active | Project-first nav with drag-order + status dots |
| c3-112 | chat-page | feature | active | Chat route shell composing transcript + input + terminal |
| c3-113 | transcript | feature | active | Virtualized hydrated transcript list |
| c3-114 | messages-renderer | feature | active | Per-kind renderers for transcript entries |
| c3-115 | chat-ui-chrome | feature | active | Composer + provider/model/effort pickers |
| c3-116 | settings-page | feature | active | Preferences, keybindings, data location |
| c3-117 | local-projects-page | feature | active | List + open locally discovered projects |
| c3-118 | terminal-workspace | feature | active | Embedded xterm panel with layout persistence |
| c3-104 | pane-layout | foundation | active | Own the user-editable pane tree: the split/close/move/focus algebra, its per-project persistence, and the resizable renderer the chat route composes. |
| c3-119 | boards-ui | feature | active | Render a project's boards as a live workspace tab — drag cards, edit a card in a drawer, edit the card schema, drive a sync binding, and start work on a card. |
| c3-120 | cron-ui | feature | active | Render the cron feature in the client: six transcript cards for cron entries, |
| c3-121 | plugins-ui | feature | active | Render what plugins contribute to the running app — sidebar entries, a chat-footer panel and a Settings page — each isolated so one bad plugin cannot take the shell down. |
| c3-122 | stacks-ui | feature | active | Render stacks in the sidebar: create one, edit its projects and instructions, start a chat on it, and read what is running across it. |
