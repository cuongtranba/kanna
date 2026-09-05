---
id: adr-20260820-background-task-output-streaming
c3-seal: 80f655665d5a5a5561993f53296d42d141dce38a30d5fabe2b92febaa6543dab
title: background-task-output-streaming
type: adr
goal: |-
    Stream the output of Claude-Code background tasks (Bash `run_in_background`,
    background Agent runs) to the Kanna UI so users can see live task progress
    without leaving the chat. Currently, background tasks are shown in the footer
    panel with an ID, type, and elapsed time, but the actual command output is
    inaccessible unless the user reads the file directly.
status: proposed
date: "2026-08-20"
---

## Goal

Stream the output of Claude-Code background tasks (Bash `run_in_background`,
background Agent runs) to the Kanna UI so users can see live task progress
without leaving the chat. Currently, background tasks are shown in the footer
panel with an ID, type, and elapsed time, but the actual command output is
inaccessible unless the user reads the file directly.

## Context

Claude Code writes `Bash(run_in_background: true)` output to a temp file whose
path appears in the tool result: `Command running in background with ID: bsh42
Output saved to: /tmp/claude-code-...out`. The server already parses the task
ID from this text (via `backgroundTaskLaunchesFromToolResult`). The file is an
append-only log that grows while the task runs.

The feature needed:

1. Server to know which file belongs to which task.
2. A polling registry that reads the file's tail and notifies subscribers when new bytes arrive, bounded in memory (256 KB `OutputRing` per task).
3. A per-client WS subscription topic so each browser tab independently controls its own polling — no global polling overhead for tasks no client is watching.
4. A client-side expand UI that subscribes and streams the content inline.

## Decision

**`BackgroundTaskOutputRegistry`** — a ref-counted polling registry injected
with `BackgroundTaskOutputDeps { statSize, readAppend, setInterval }` so no IO
enters the domain layer. One `OutputRing(256 KB)` per task. The poll starts on
the first watcher and stops when the last watcher unsubscribes. `getOutput`
returns `{ content, truncated }` — `truncated: true` when more than 256 KB has
been written to the file.

**`SessionBackgroundTask.outputPath`** — added to track the file per task.
`backgroundTaskLaunchesFromToolResult` is extended to capture the output path
alongside the task ID. `onBackgroundTaskLaunch` / `onBackgroundTaskSettle`
optional deps on `RunClaudeSessionDeps` call through to `trackTask` /
`untrackTask` on the registry.

**WS protocol** — new `SubscriptionTopic { type: "background-task-output"; chatId; taskId }`,
`BackgroundTaskOutputSnapshot { chatId; taskId; content; truncated }`,
`ClientCommand { type: "backgroundTasks.getOutput"; ... }`. Subscribe adds a
watcher; unsubscribe and socket close remove it. `BroadcastManager` subscribes
to the registry's `subscribe` callback and pushes snapshots to matching
per-subscription sockets.

**Client** — `BackgroundTasksSectionStore` (scoped Zustand store, per-instance)
holds `expandedTaskId` and `output`. `BackgroundTasksSection` subscribes to the
WS topic when a task is expanded. `ChatBackgroundTask.hasOutput: boolean`
(derived from `outputPath != null`) controls whether the expand chevron is shown
without revealing the server-internal path to the client.

## Affected Topology

| Entity | Type | Why affected |
| --- | --- | --- |
| c3-2 | container | New server registry + adapter wired in server.ts |
| c3-1 | container | New BackgroundTasksSection.store.ts; chatId prop added to BackgroundTasksSection |
| c3-3 | container | ChatBackgroundTask.hasOutput, BackgroundTaskOutputSnapshot, new WS topic + command |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 6673 pass, 0 fail (pre-existing timing-flaky loop-tracking and PTY tests occasionally appear; pass in isolation and on main) |
| bun run typecheck | clean |
| bun run lint | clean at --max-warnings=0 |
| bunx ast-grep test | 15 passed, 0 failed |
| bun run lint:usestate | clean |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Global polling for all tracked tasks | Wastes server CPU on tasks no client is watching |
| SSE / HTTP endpoint for output | Adds a new transport; WS subscription keeps the same back-pressure model the rest of Kanna uses |
| Send full output on every poll tick | Large output would dominate WS bandwidth; OutputRing bounds at 256 KB and the signature check in BroadcastManager skips unchanged snapshots |
| Expose outputPath on the client | Unnecessary; hasOutput: boolean is sufficient to decide whether the expand UI should appear |
