---
id: adr-20261008-live-block-streaming
c3-seal: ba81d7c37038deecf6df97c532346453c94145ce477a2e616e38b9c17e0e243b
title: live-block-streaming
type: adr
goal: 'Show the model''s output while it is being generated instead of only after each content block completes. The Claude SDK session for a main chat now runs with `includePartialMessages: true` and `--thinking-display summarized`; the harness folds the SDK''s `stream_event` frames into one `LiveBlock` (text, thinking, or a tool call with its target and input size), and the server pushes it to the chat''s subscribers as an ephemeral `chat.live` event that the client renders in place of the generic Running indicator. Nothing about a live block is persisted.'
status: proposed
date: "2026-10-08"
---

## Goal

Show the model's output while it is being generated instead of only after each content block completes. The Claude SDK session for a main chat now runs with `includePartialMessages: true` and `--thinking-display summarized`; the harness folds the SDK's `stream_event` frames into one `LiveBlock` (text, thinking, or a tool call with its target and input size), and the server pushes it to the chat's subscribers as an ephemeral `chat.live` event that the client renders in place of the generic Running indicator. Nothing about a live block is persisted.

## Context

The SDK emits one `assistant` message per completed content block, so a 60 s thinking phase, a long reply, or a 20 KB `Write` input produced no transcript entry until it finished, and the chat showed only "Running..." (chat 071d8b8f: 86 s and 62 s gaps, read by the user as a hung session). Thinking text was also never shown: the model's default thinking display is omitted, so thinking blocks arrived empty and the normalizer dropped them (3,168 thinking tokens in one turn, zero `assistant_thinking` entries). Measured on SDK 0.3.289 / CLI 2.1.280: `--thinking-display summarized` fills thinking blocks and deltas on Opus and Haiku alike, and also emits one `system/thinking_tokens` message per delta. The chat-state broadcast rebuilds the sidebar and chat meta every pass and the ChatOpLog ring holds 512 ops, so neither can carry several updates per second.

## Decision

Live blocks travel a channel of their own and are never transcript entries. `createClaudeHarnessStream` consumes `stream_event` (top-level frames only, `parent_tool_use_id` null) and `system/thinking_tokens` before the `session_token` yield, so neither triggers a chat broadcast, and yields a new `HarnessEvent` variant `live`. The session runner publishes it through `onLiveBlock` and clears it when a completed assistant_text, assistant_thinking, tool_call or result entry arrives or the stream ends. `LiveBlockHub` throttles per chat (first update immediately, then at most every 100 ms with the latest block), keeps the latest block for a socket that subscribes mid-generation, and defers its clear by one interval so a following block cannot overtake the previous block's entry; the client clears the overlay itself in the same handler that applies that entry, so no frame shows neither. `--thinking-display` is passed through `extraArgs` rather than the `thinking` option because the option also forces `--thinking adaptive`. Subagent sessions do not request partial messages.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | The session runner handles the new live event and owns the accumulator and publisher | c3-210#n11308@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | runClaudeSession stays under the max-depth and complexity ceilings |
| c3-205 | component | HarnessEvent gains the live variant that every consumer switch must handle | c3-205#n11039@v1:sha256:360cde9c009b55fb3b85083d974f20e76a35d969e68a6d0c27e8b9a2e5856686 "Define the typed event union (project/chat/message/turn) appended to JSONL logs." | exhaustive never checks in every HarnessEvent switch |
| c3-208 | component | The WS router pushes chat.live and owns the throttle hub | c3-208#n11207@v1:sha256:3b682e08c742ff6ed2ec0fe7e93f9508e535bd265f8c630d292aa17868013d79 "Multiplex WS traffic: route subscribe/unsubscribe/command envelopes, push projections on every state change." | no new dispatch arms in ws-router.ts |
| c3-302 | component | WsEvent gains chat.live and the LiveBlock contract lives in shared | c3-302#n13062@v1:sha256:4c7ecffd69e947220d2e183aff508ff27068adad53b1b11d4434236e59af2b8b "Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids)." | a type lives in shared once |
| c3-114 | component | LiveTurnIndicator renders the overlay in place of ProcessingMessage | c3-114#n10328@v1:sha256:27c34f0051a7a59d7cab24990ec538a17e38cf2740694a17b24b0257ac9fc82f "Render each transcript entry kind (text, tool call, write_file, delete_file, plan, diff, ...) consistently, with collapse/expand and status." | DESIGN.md tokens and tabular-nums |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/claude-harness-stream.test.ts src/server/live-block-throttle.test.ts src/server/claude-session-runner.test.ts src/server/claude-session-start.test.ts src/client/components/messages/LiveTurnIndicator.test.tsx | all pass |
| bun run check | typecheck, lint, client build and bundle budget pass |
| Smoke check in bun run dev: a prompt that thinks, writes a file, then replies | Thinking… with summarized text, then a Write row with target path and growing size, then the streamed reply, each replaced by its completed entry |
