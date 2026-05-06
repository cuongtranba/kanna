---
id: c3-1
c3-version: 4
c3-seal: 7bd272039f9d8c8d53f6e80a9466c5ffdbd6823217219f3ad39335cc0eaa8a10
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
| c3-101 | socket-client | foundation | implemented | Single WS transport + typed envelope dispatch |
| c3-102 | state-stores | foundation | implemented | UI-local state via per-concern Zustand stores |
| c3-103 | ui-primitives | foundation | implemented | Radix + shadcn primitives used by every feature |
| c3-110 | app-shell | feature | implemented | Router, central state hook, socket wiring |
| c3-111 | sidebar | feature | implemented | Project-first nav with drag-order + status dots |
| c3-112 | chat-page | feature | implemented | Chat route shell composing transcript + input + terminal |
| c3-113 | transcript | feature | implemented | Virtualized hydrated transcript list |
| c3-114 | messages-renderer | feature | implemented | Per-kind renderers for transcript entries |
| c3-115 | chat-ui-chrome | feature | implemented | Composer + provider/model/effort pickers |
| c3-116 | settings-page | feature | implemented | Preferences, keybindings, data location |
| c3-117 | local-projects-page | feature | implemented | List + open locally discovered projects |
| c3-118 | terminal-workspace | feature | implemented | Embedded xterm panel with layout persistence |
