---
id: adr-20260802-background-selfwake-status-ui
c3-seal: bf0dc2f6cfa293ad7c120fe1cd766b63249cea5860d1fdcdfe07abaef9879652
title: background-selfwake-status-ui
type: adr
goal: 'Surface Claude-Code background-task self-wake activity in the chat UI: when a task-notification wake turn streams on the warm Claude session WITHOUT a Kanna-driven turn, the chat must report status "running" (composer spinner + Stop reaches the work), and the runtime must list WHICH background tasks are live (id, type, description, elapsed) — the Kanna analog of Claude Code''s /tasks view.'
status: accepted
date: "2026-08-02"
---

## Goal

Surface Claude-Code background-task self-wake activity in the chat UI: when a task-notification wake turn streams on the warm Claude session WITHOUT a Kanna-driven turn, the chat must report status "running" (composer spinner + Stop reaches the work), and the runtime must list WHICH background tasks are live (id, type, description, elapsed) — the Kanna analog of Claude Code's /tasks view.

## Context

Kanna's chat status is folded exclusively from turn events (`turn_started` → running, `turn_finished` → idle) and `getActiveStatuses` read only `activeTurns`. Task-notification self-wake turns (background Bash/Agent completions waking the model) stream transcript entries with no ActiveTurn — observed in session f651da60-bfd7-4971-9c05-98a871445f5f, where the model worked 70+ minutes after the last `turn_finished` while the composer showed the idle arrow and offered no Stop. The session-level keep-alive guard (`backgroundTaskIds` Set, adr-20260604/adr-20260801) tracked ids only, so the UI could not name the running tasks; the SDK `background_tasks_changed` payload already carries `task_type` + `description` but the normalizer dropped them.

## Decision

Track the self-wake window on `ClaudeSessionState.selfWakeActive` — armed by the session runner when a model-activity entry (assistant_text / assistant_thinking / tool_call / tool_result) streams with no ActiveTurn, disarmed on the wake turn's `result` — and fold it into `getActiveStatuses` as a "running" overlay (pure live-state overlay; event-sourced turn timings untouched). Upgrade the keep-alive guard from `backgroundTaskIds: Set<string>` to `backgroundTasks: Map<string, SessionBackgroundTask>` (single source of truth; `taskType`/`description` from the `background_tasks_changed` snapshot, launch-regex fallback enriched from the launching tool_call's description; first-seen `startedAt`). Thread per-chat task lists through `deriveChatSnapshot` onto `ChatRuntime.backgroundTasks` and render a `BackgroundTasksSection` in the chat footer. `cancelChat` gains a no-active-turn branch that interrupts the session stream when `selfWakeActive` (SDK in-band interrupt; PTY drops the dead session), suppressing the interrupt-induced tail result like a cancelled Kanna turn.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | getActiveStatuses gains the self-wake "running" overlay; cancelChat gains the self-wake interrupt branch; coordinator exposes getBackgroundTasksByChatId | c3-210#n7082@v1:sha256:8051e7f3d3af5ab66a7c2590d4cc9d8181424c370878605c398c95143a07e9f6 | Business Flow table gains the self-wake alternate row (this unit) |
| c3-207 | component | deriveChatSnapshot accepts backgroundTasksByChatId and emits ChatRuntime.backgroundTasks (same ephemeral-overlay pattern as claudeSessionStates) | c3-207#n6915@v1:sha256:a58472ad11b1c57852907b089782785a24635670c5164aff68c7e77f7d9e4f6c | Existing Purpose/flows stay true; no frozen claim contradicted |

## Verification

| Check | Result |
| --- | --- |
| bun run test (full suite, --conditions production) | 4335 pass / 0 fail |
| bun run lint && bun run lint:usestate && bunx ast-grep test | clean, 0 warnings, 12/12 rule tests |
| bun run typecheck (TS7) | clean |
| bun test src/server/claude-session-runner.test.ts (self-wake arm/disarm, snapshot meta, launch enrichment) | 24 pass |
| bun test src/server/claude-cancel-handler.test.ts (self-wake interrupt branch) | pass |
| bun test src/client/app/BackgroundTasksSection.test.tsx (renderForLoopCheck, no loop warnings) | 3 pass |
