---
id: adr-20260818-adr-20260818-chat-activity-sidebar-row
c3-seal: d4258c6634e032c98ec70c31384719b664be30d5fe25738697e49e651978cecb
title: adr-20260818-chat-activity-sidebar-row
type: adr
goal: 'Replace the thin `hasAutomation: boolean` field on `SidebarChatRow` with a structured `ChatActivity` interface carrying six live-state signals (running agents, active workflow summary, loop progress, background task count, next cron fire, and awaiting-answer flag). Add `computeChatActivity` as a pure projection function in read-models and thread the required registries through `deriveSidebarData`. Expose `activity` on `CardChatFacts` so boards see the same live state the sidebar row does.'
status: done
date: "2026-08-18"
---

## Goal

Replace the thin `hasAutomation: boolean` field on `SidebarChatRow` with a structured `ChatActivity` interface carrying six live-state signals (running agents, active workflow summary, loop progress, background task count, next cron fire, and awaiting-answer flag). Add `computeChatActivity` as a pure projection function in read-models and thread the required registries through `deriveSidebarData`. Expose `activity` on `CardChatFacts` so boards see the same live state the sidebar row does.

## Context

`SidebarChatRow.hasAutomation` was a single boolean derived from unpaired cron jobs. Issue #761 requires richer live-state for the sidebar: animated icons for running subagents, workflow progress, loop progress, background tasks, cron schedule, and the awaiting-answer badge. All six signals are already computable from state already held by `ws-router-envelope` — they only need a new projection function and the existing registry injections threaded through. The `CardChatFacts` type in boards was a structural subset of `SidebarChatRow`; adding `activity` there keeps it consistent and lets card faces eventually render the same indicators.

## Decision

1. Introduce `ChatActivity` interface and `EMPTY_CHAT_ACTIVITY` zero value in `src/shared/types.ts` (c3-301).
2. Replace `SidebarChatRow.hasAutomation: boolean` with `SidebarChatRow.activity: ChatActivity`.
3. Add `computeChatActivity(chatId, deps)` pure function in `src/server/read-models.ts` (c3-207); `deriveSidebarData` accepts optional `workflowRegistry`, `backgroundTasksByChatId`, and `getLoopTracking` deps so the envelope can inject live registries without changing the pure projection contract.
4. Add `activity: ChatActivity` to `CardChatFacts` in `src/client/lib/boards/cardChatSignal.ts` and thread it through `buildBoardChatFacts` (c3-119).
5. Update all test fixtures replacing `hasAutomation: false` with `activity: EMPTY_CHAT_ACTIVITY`.

The pure-projection approach keeps `read-models.ts` side-effect-free: the injected deps are optional and default to no-ops so any existing call site without the registries is unchanged.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-301 | component | Adds ChatActivity / EMPTY_CHAT_ACTIVITY exports; SidebarChatRow.activity replaces hasAutomation | c3-301#n11018@v1:sha256:8d8460221bf4eb295f964884b40a9ba6302a9c2af2f9b1997cbed42fda139de8 | ref-strong-typing: all new types are explicit, no any/unknown |
| c3-207 | component | Adds computeChatActivity function; deriveSidebarData gains optional workflowRegistry, backgroundTasksByChatId, getLoopTracking deps | c3-207#n9492@v1:sha256:07b352dd3df1f034dccd3db20a823f86fd731306d39da4146889c33db748758b | ref-cqrs-read-models: projection stays pure, no IO; ref-strong-typing: typed deps interface |
| c3-119 | component | CardChatFacts gains activity:ChatActivity field; buildBoardChatFacts threads it from SidebarChatRow | c3-119#n9041@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | ref-strong-typing: structural subset of SidebarChatRow preserved |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | Exit 0, zero type errors |
| bun run lint | Exit 0, zero warnings |
| bun run lint:usestate | Exit 0, no ast-grep violations |
| bun run test | All 838 tests pass |
