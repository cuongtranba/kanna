---
title: From send to "Starting..."
description: The path from a submitted prompt to the transcript's "Starting..." row, and how to profile the delay between them.
---

This traces what happens between a user submitting a prompt and the transcript
showing the `Starting...` processing row.

## The sequence

1. The composer calls `handleSend(...)` in `src/client/app/useKannaState.ts`.
2. The client immediately inserts an optimistic `user_prompt` entry into local state.
3. The client sends a `chat.send` WebSocket command.
4. The server handles `chat.send` in `src/server/ws-router-chat.ts`, which delegates
   to `AgentCoordinator.send(...)` in `src/server/agent-coordinator.ts`.
5. If this is a new chat, the server creates the chat before starting the turn.
6. `startTurnForChat(...)` runs the preflight work: it sets the provider if missing,
   persists plan mode, applies an optimistic title for the first message of a new
   chat, appends the real `user_prompt` transcript entry, and records `turn_started`.
7. The server boots the provider turn. Claude creates or reuses its session, then
   sends the prompt; Codex starts its session, then starts the turn.
8. The server registers the turn in `activeTurns` with runtime status `running`
   (Claude) or `starting` (Codex).
9. `AgentCoordinator` calls `onStateChange()`, and `broadcastSnapshots()` in
   `src/server/ws-router-broadcast.ts` pushes fresh snapshots.
10. `deriveChatSnapshot(...)` in `src/server/read-models.ts` merges the persisted
    transcript with the in-memory runtime status.
11. The client's chat subscription receives the new `ChatSnapshot`, and
    `useKannaState(...)` resolves `runtime.status` from it.
12. The chat page renders `<ProcessingMessage status="starting" />` while the chat is
    processing and `runtime.status === "starting"`; `ProcessingMessage.tsx` maps
    `starting` to `Starting...`.

## The optimistic prompt does not control "Starting..."

`Starting...` appears only after the server has accepted `chat.send`, started the
turn, registered the runtime as `starting`, and rebroadcast a snapshot that the
client then received and rendered. Any latency in that chain widens the gap between
the optimistic prompt and the loading row.

## Profiling the gap

Each send carries a `clientTraceId`; client and server log checkpoints against it.

**Client.** In the browser console, then reload:

```js
sessionStorage.setItem("kanna:profile-send-to-starting", "1")
```

Logs carry the prefix `[kanna/send->starting][client]`. Checkpoints:
`handle_send_called`, `optimistic_prompt_added`, `chat_send_ack_received`,
`chat_snapshot_received`, `runtime_status_starting`, `starting_render_committed`,
and `starting_not_observed`.

**Server.** Start Kanna with the flag set:

```bash
KANNA_PROFILE_SEND_TO_STARTING=1 bun run ./src/server/cli.ts
```

Logs carry the prefix `[kanna/send->starting][server]` and come from four modules:
`chat_send.*` from `claude-send-command.ts`, `start_turn.*` from
`claude-turn-starter.ts`, `ws.snapshot_sent` from `ws-router-broadcast.ts`, and
`ws.chat_send_ack` from `ws-router-chat.ts`. In order: `chat_send.received`,
`chat_send.chat_created`, `start_turn.begin`, `start_turn.provider_set`,
`start_turn.plan_mode_set`, `start_turn.optimistic_title_set`,
`start_turn.user_prompt_appended`, `start_turn.turn_started_recorded`,
`start_turn.provider_boot.begin`, `start_turn.session_ready`,
`start_turn.provider_boot.ready`, `start_turn.active_turn_registered`,
`start_turn.state_change_emitted`, `start_turn.claude_prompt_sent`,
`chat_send.ready_for_ack`, `ws.snapshot_sent`, `ws.chat_send_ack`.

## Reading the timeline

Match the client and server logs for one send by trace id, then compare these
buckets:

| Bucket | From | To |
| --- | --- | --- |
| Client preflight | `handle_send_called` | `optimistic_prompt_added` |
| WebSocket round trip | `optimistic_prompt_added` | `chat_send_ack_received` |
| Server pre-turn work | `chat_send.received` | `start_turn.turn_started_recorded` |
| Provider startup | `start_turn.provider_boot.begin` | `start_turn.provider_boot.ready` |
| Snapshot propagation | `start_turn.state_change_emitted` / `ws.snapshot_sent` | `chat_snapshot_received` |
| UI commit | `runtime_status_starting` | `starting_render_committed` |

A delay that grows over time usually points at one of: a WebSocket command backlog,
event-store writes for the transcript append and turn events, provider session
startup, snapshot broadcast cost, or client snapshot reconciliation and render cost.
