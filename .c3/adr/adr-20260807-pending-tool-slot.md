---
id: adr-20260807-pending-tool-slot
c3-seal: 1392d5b99c687662b4deeb24d7a0f11b8d847b6ae362709e4bfb852f129264c8
title: pending-tool-slot
type: adr
goal: 'Eliminate the ghost-ActiveTurn design for out-of-turn `canUseTool` requests: parked AskUserQuestion / ExitPlanMode continuations move off `ActiveTurn.pendingTool` into a per-chat `PendingToolSlots` registry (`src/server/pending-tool-slot.ts`) that is independent of turn lifetime, and "is this chat busy?" becomes a single derivation (`isChatBusy` in `claude-session-state-queries.ts`) consumed by the send gate and the queued-message drain. `recreateActiveTurnFromSession`, the `rebuiltFromSession` flag, and `claude-session-rebuild.ts` are deleted.'
status: accepted
date: "2026-08-07"
---

# pending-tool-slot

## Goal

Eliminate the ghost-ActiveTurn design for out-of-turn `canUseTool` requests: parked AskUserQuestion / ExitPlanMode continuations move off `ActiveTurn.pendingTool` into a per-chat `PendingToolSlots` registry (`src/server/pending-tool-slot.ts`) that is independent of turn lifetime, and "is this chat busy?" becomes a single derivation (`isChatBusy` in `claude-session-state-queries.ts`) consumed by the send gate and the queued-message drain. `recreateActiveTurnFromSession`, the `rebuiltFromSession` flag, and `claude-session-rebuild.ts` are deleted.

## Context

Session 04fb43c9-fa05-406b-b552-c6e8c077c734 ended its background-task self-wake work at 15:27 but the chat stayed "running" forever, a user send at 15:29 was queued and never drained, `selfWakeActive` stayed wedged true, and the idle reaper was blocked. Root cause: during the self-wake the model called `AskUserQuestion` outside any Kanna turn; because the parked resolve could only live on an `ActiveTurn`, `recreateActiveTurnFromSession` fabricated a ghost turn (adr-20260804-main-agent-pending-question-wedge). That ADR made the result matcher never claim a ghost (`!active.rebuiltFromSession`) — but the matcher is the only delete path on a result, so the answered ghost leaked in `activeTurns` permanently: the send gate read it as busy, `getActiveStatuses` reported "running", the self-wake disarm branch (gated on `!activeTurns.has`) never ran, and the reaper predicate (any claude ActiveTurn → not idle) could never fire — the ghost blocked the one path that would have removed it. This is the sixth fix in a causal chain (adr-20260604-pty-background-task-keepalive → adr-20260722-background-agent-keepalive → adr-20260801-background-task-wake-escalation → adr-20260802-background-selfwake-status-ui → adr-20260804-cancel-during-turn-boot → adr-20260804-main-agent-pending-question-wedge) where each patch special-cased one consumer of `activeTurns` and the next unpatched consumer produced the next wedge. Two structural defects underlie the whole chain: (1) the parked continuation was structurally coupled to a turn, forcing fake turns into a map every busy-consumer reads; (2) busyness was derived ad-hoc from three independently-mutated states (`activeTurns`, `selfWakeActive`, `startingTurns`) at each call site.

## Decision

Decouple the parked continuation from turn lifetime. A new `PendingToolSlots` class (side-effect-sealed, keyed by chatId) is the single home for parked requests, with exactly four transitions: `park` (dedup — an occupied slot is discarded first), `take`/`takeAny` (remove without settling, so the caller can append the discarded/answered `tool_result` transcript entry BEFORE resolving the SDK worker), and `discard` (remove and settle with `discardedToolResult`, which `buildCanUseTool` short-circuits to deny). `onToolRequest` parks in the slot whether or not a turn is live — no ghost turn is ever created, so `activeTurns` again contains only real Kanna-initiated turns and every consumer is correct by construction. Settle sites: `cancelChat` first (turn-independent — ONE Stop frees a question parked mid-turn or mid-self-wake and clears `selfWakeActive` in the same press), the runner's real-turn finalize, the self-wake disarm branch (which now also drains the queued-message queue via `maybeStartNextQueuedMessage` — previously messages queued during a wake had no drain), and the runner's `finally` on session death. The reaper (`isClaudeSessionIdle`) and budget enforcer (`enforceClaudeSessionBudget`) refuse to close a session whose chat holds a parked slot — the worker is blocked inside `canUseTool`, so `lastUsedAt` stales while the user reads the question (previously only the ghost accidentally provided this protection). Busyness becomes one exported derivation `isChatBusy` = live turn ∨ booting turn ∨ parked slot ∨ streaming self-wake, consumed by `sendCommand` and `maybeStartNextQueuedMessage`. Chosen over patching the ghost's delete path (a seventh special-case in the same whack-a-mole chain — e.g. a ghost whose wake stream dies before any result would still leak) and over routing the SDK driver through the durable tool-callback protocol (correct long-term but the largest blast radius; already deferred by adr-20260804-main-agent-pending-question-wedge and not needed to fix the structural defect). This supersedes the ghost-turn machinery of adr-20260804-main-agent-pending-question-wedge while keeping its other three fixes (footer card, cancel resolves for every provider, discarded→deny short-circuit) intact.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns turn lifecycle: pendingTool storage moves to PendingToolSlots, ghost-turn rebuild deleted, cancel/self-wake/reaper flows re-anchored on the slot, isChatBusy single derivation added | c3-210#n8062@v1:sha256:4a386bbb6245bc556945a885bbe658aac5bd64eb9a707f4b26689725186353fe | Confirm the slot is the only pending-tool home and no consumer re-grows a turn-attached copy |
| c3-2 | container | Server container holds the coordinator; no responsibility moves, all changes internal to c3-210's modules | c3-2#n7531@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Verify no-delta at container level |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | The slot is provider-agnostic: claude, codex and openrouter park through the same onToolRequest closure and cancel settles for every provider/toolKind pair | ref-provider-adapter#n9746@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply |
| ref-colocated-bun-test | New module ships pending-tool-slot.test.ts beside it; every touched module's colocated suite updated to slot semantics | ref-colocated-bun-test#n9614@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | pending-tool-slot.test.ts colocated with pending-tool-slot.ts; regression fixture for session 04fb43c9 lives in claude-session-runner.test.ts next to the runner | rule-colocated-bun-test#n9949@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |
| rule-strong-typing | ParkedTool, PendingToolSlots, ChatBusyDeps and the widened deps interfaces are named exports crossing the coordinator↔module boundaries | rule-strong-typing#n10010@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |
| rule-zustand-store | Cascaded from the c3-2 container row; this change is server-only — no client store, component, or JSX touched, and the UI keeps consuming the unchanged PendingToolSnapshot shape | rule-zustand-store#n10042@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | N.A - server-only change, no client state introduced |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Slot module | PendingToolSlots (park/take/takeAny/discard) + ParkedTool type | src/server/pending-tool-slot.ts, src/server/pending-tool-slot.test.ts |
| Park site | onToolRequest parks in the slot with or without a live turn; ghost rebuild call deleted | src/server/claude-turn-starter.ts |
| Ghost machinery deleted | recreateActiveTurnFromSession + rebuiltFromSession flag + module removed; findLastUserMessageId relocated as a pure function | src/server/claude-session-rebuild.ts (deleted), src/server/claude-prompt-helpers.ts, src/server/claude-session-state.ts |
| Respond | respondTool takes from the slot; codex postToolFollowUp keeps working when a turn is live | src/server/claude-tool-respond.ts |
| Cancel | takeAny → append tool_result → resolve, before any turn/self-wake branching; one Stop clears slot + selfWakeActive | src/server/claude-cancel-handler.ts |
| Runner | discard at real-turn finalize + finally; self-wake disarm discards defensively and drains the queue | src/server/claude-session-runner.ts |
| Queries + gates | getPendingTool/getActiveStatuses/getWaitStartedAtByChatId read the slot; isClaudeSessionIdle + enforceClaudeSessionBudget refuse to reap a parked chat; isChatBusy exported and consumed by sendCommand + maybeStartNextQueuedMessage | src/server/claude-session-state-queries.ts, src/server/claude-session-lifecycle.ts, src/server/claude-send-command.ts |
| Coordinator wiring | pendingTools field threaded through all deps builders | src/server/agent-coordinator.ts, src/server/agent-deps-builders.ts |
| Docs | CLAUDE.md pending-tool section rewritten around the slot | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| pending-tool-slot.test.ts | Slot transitions: park/get/take/takeAny/discard, dedup-park, per-chat isolation | bun test src/server/pending-tool-slot.test.ts |
| claude-session-runner.test.ts | Regression fixture 04fb43c9: out-of-turn park + answer + wake result ends fully idle (no turn, selfWake false, slot empty, queue drained); stream-end settle; finalize settle | bun test src/server/claude-session-runner.test.ts |
| claude-cancel-handler.test.ts | One Stop settles an out-of-turn parked request AND clears selfWakeActive; provider×toolKind settle table; append-before-resolve ordering | bun test src/server/claude-cancel-handler.test.ts |
| claude-session-state-queries.test.ts | waiting_for_user overlay, parkedAt wait overlay, reaper refusal on parked slot | bun test src/server/claude-session-state-queries.test.ts |
| claude-tool-respond.test.ts | respondTool answers a request parked with NO active turn through the same path as mid-turn | bun test src/server/claude-tool-respond.test.ts |
| agent.test.ts | Integration: late canUseTool parks in the slot (no ghost in activeTurns) and respondTool resolves it | bun test src/server/agent.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Patch the ghost's delete path (settle + remove on wake result) | Seventh special-case in the same chain; leaves ghost semantics in every activeTurns consumer and still leaks when a wake stream dies before any result |
| Route the SDK driver through the durable tool-callback protocol (KANNA_MCP_TOOL_CALLBACKS) | Largest blast radius (changes the answer RPC and rendering component); already deferred by adr-20260804-main-agent-pending-question-wedge; does not remove the ad-hoc busy derivation |
| Keep ActiveTurn.pendingTool for real turns, slot only for out-of-turn | Two homes for one datum violates single-source-of-truth; every reader needs a fallback chain and the divergence class returns |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Send gate now queues during self-wake where it previously started a turn immediately | Intentional: interleaving a prompt into a busy stream was ill-defined; the wake's terminal result now drains the queue, and queued cards keep their "Send now" escape hatch | claude-session-runner.test.ts (drain on disarm), claude-send-command.test.ts |
| A wedged selfWakeActive flag could park sends forever | Flag dies with the session (finally clears it and the map entry); the reaper still keys on lastUsedAt for streaming wakes | claude-session-runner.test.ts stream-end test |
| Codex exit_plan_mode followUp regression (provider now read from the parked request) | postToolFollowUp still set when a codex turn is live; covered by both confirmed and rejected paths | bun test src/server/claude-tool-respond.test.ts |
| A parked slot pins a session against the reaper indefinitely | Same bound as before (the ghost pinned it too); cancel and respondTool both free it, and the 600s tool-request timeout on the durable path is unchanged | claude-session-state-queries.test.ts reaper test |

## Verification

| Check | Result |
| --- | --- |
| bun run test | pass (5012 pass, 2 skip, 0 fail) |
| node node_modules/typescript-7/bin/tsc --noEmit | clean |
| bun run lint | clean (0 errors, 0 warnings) |
| bunx ast-grep test | ok, 14 passed |
| bun run lint:usestate | clean |
