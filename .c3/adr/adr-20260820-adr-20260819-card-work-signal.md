---
id: adr-20260820-adr-20260819-card-work-signal
c3-seal: 5f60e55d833c825b58f572113bbe364827749dc908a22879013b95ec0998bbac
title: adr-20260819-card-work-signal
type: adr
goal: 'Replace `cardChatSignal` (session-status-only) with `cardWorkSignal` — a 10-row first-match-wins priority table answering "what is working this issue right now" across all six activity kinds: session errors, subagent failures, awaiting-answer, workflow, loop, background agents, armed cron, and bare session status. Add `ChatActivity.lastRunFailure` to expose the newest failed subagent run to the card layer. Add `"muted"` to `ChatDotTone` for scheduled-cron state.'
status: proposed
date: "2026-08-20"
---

## Goal

Replace `cardChatSignal` (session-status-only) with `cardWorkSignal` — a 10-row first-match-wins priority table answering "what is working this issue right now" across all six activity kinds: session errors, subagent failures, awaiting-answer, workflow, loop, background agents, armed cron, and bare session status. Add `ChatActivity.lastRunFailure` to expose the newest failed subagent run to the card layer. Add `"muted"` to `ChatDotTone` for scheduled-cron state.

## Context

`cardChatSignal` mapped session status via `chatStatusIndicator` — the same table the sidebar row uses. Cards linked to chats with background agents, armed loops, or cron jobs showed nothing: the agent count, loop fraction, and cron countdown lived in `ChatActivity` (adr-20260818-chat-activity-sidebar-row) but the card function ignored it. The old function also returned a flat `liveSince` timestamp, which forced `LiveStamp` to be elapsed-only; a cron countdown needs the opposite direction. Two functions were needed: one that reads all six activity dimensions, and a clock type that carries direction.

## Decision

1. Add `ChatActivity.lastRunFailure: { code: SubagentErrorCode | null } | null` in `src/shared/types.ts`: the newest subagent run's failure by `startedAt`, cleared when any newer run exists of any status.
2. Add `"muted"` to `ChatDotTone` in `src/client/lib/chatStatusIndicator.ts` with `bg-muted-foreground` background; no `chatStatusIndicator` call for scheduled state (muted is not a session status, it is a schedule signal).
3. Add `formatCountdown(ms)` to `src/client/lib/formatDuration.ts` using `Math.ceil` so a 12m wait reads exactly "12m" from the moment it is set.
4. Replace `src/client/lib/boards/cardChatSignal.ts` with `src/client/lib/boards/cardWorkSignal.ts`. New exports: `CardChatFacts` (identical shape), `WorkClock` (`{kind:"elapsed",since:number}|{kind:"countdown",until:number}`), `CardWorkSignal` (uses `clock` instead of `liveSince`), `cardWorkSignal` function with the 10-row table.
5. Update `computeChatActivity` in `src/server/read-models.ts` to derive `lastRunFailure` from the newest subagent run and reuse the computed `agents` count in the loop total.
6. Update `KannaBoard.tsx` to import `cardWorkSignal`; rewrite `LiveStamp` to branch on `clock.kind`.
7. Update `src/client/lib/boards/boardChatFacts.ts` to import `CardChatFacts` from `cardWorkSignal`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-301 | component | ChatActivity gains lastRunFailure; ChatDotTone gains "muted"; EMPTY_CHAT_ACTIVITY zero-value updated | c3-301#n11351@v1:sha256:95468d2c3d8399101f3673d1f0b77138b3dcbac0ef62173d39f470788cf0430d | Contract row added; EMPTY_CHAT_ACTIVITY zero-value kept consistent |
| c3-207 | component | computeChatActivity derives lastRunFailure from newest subagent run snapshot; agents count reuse | c3-207#n9818@v1:sha256:6f0724e54daffc6916e15e601a01638736a3372afca237f76a50bf3d43802dc9 | Contract row updated to include lastRunFailure in OUT surface |
| c3-119 | component | cardChatSignal replaced by cardWorkSignal; LiveStamp uses WorkClock; formatCountdown added | c3-119#n9347@v1:sha256:a6ef62e3bb756806b9a0b944a25f4ec51a5ddf8be06021f7310044af41fc2469 | New card-signal surface added to Contract table |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | Exit 0, zero type errors |
| bun run lint | Exit 0, zero warnings, max-warnings=0 |
| bun run lint:usestate | Exit 0, no ast-grep violations |
| bun run test | 6703 pass, 0 fail |
