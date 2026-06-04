---
id: adr-20260604-adr-20260604-pty-background-task-keepalive
c3-seal: 2d71a80fc0ca59ff211005adfc64e59354d8d067ef750b11f3bb560b9c3cf3da
title: adr-20260604-pty-background-task-keepalive
type: adr
goal: |-
    Stop the PTY claude session idle-reaper from tearing down a warm process while a
    Claude-Code background Bash task (`Bash(run_in_background: true)`) launched in the
    previous turn is still running. Add a per-session keep-alive guard so the process
    survives long enough to receive Claude Code's `<task-notification>` completion line,
    which the existing continuous transcript tail already routes back into the chat as a
    real re-entry turn. PTY driver only.
status: implemented
date: "2026-06-04"
---

## Goal

Stop the PTY claude session idle-reaper from tearing down a warm process while a
Claude-Code background Bash task (`Bash(run_in_background: true)`) launched in the
previous turn is still running. Add a per-session keep-alive guard so the process
survives long enough to receive Claude Code's `<task-notification>` completion line,
which the existing continuous transcript tail already routes back into the chat as a
real re-entry turn. PTY driver only.

## Context

Symptom (session `e0df81b2-1ddb-44d5-b46a-22cf3cc29d9a`): the model launched a
background Bash job to poll `gh pr checks` until CI settled, said "Waiting on CI in
background. Will report + merge once checks settle.", then ended its turn
(`system/turn_duration`). The chat went silent forever and the user observed Kanna
"stopping the PTY instance".

Evidence: the background `*.output` file is 0 bytes; the turn ended at 13:59:48 and the
CC transcript shows only housekeeping sidecar writes at 14:10:05 — exactly the
`DEFAULT_CLAUDE_SESSION_IDLE_MS` (10 min) after turn end. `isClaudeSessionIdle`
(`agent.ts:1428`) returned true (no active turn, no pending prompt seq, no live
workflow), so `sweepIdleClaudeSessions` → `closeClaudeSession` → `session.close()`
killed the PTY process. The background bash child died with its parent before CI
finished, so its `<task-notification>` was never written and the agent never re-entered.

Key facts established during investigation:

- `<task-notification>` lines are `type=user`, `isMeta` is NOT `true`, so the #332
auto-wake filter in `jsonl-to-event.ts` does NOT drop them. In native CC the
notification reliably triggers a re-entry turn (verified: notification line → next
assistant turn).
- The PTY stream consumer (`agent.ts:2727`) is a continuous tail that `appendMessage`s
every disk line even with no open Kanna turn; a `result` with no active turn no-ops
the prompt-seq logic. So the re-entry turn already flows to the store/UI — the ONLY
missing piece is keeping the process alive until the notification fires.
- Workflows already have the identical guard: `hasLiveWorkflow` (`agent.ts:1424`) is
consulted by both `isClaudeSessionIdle` and `enforceClaudeSessionBudget`. Background
Bash tasks have no equivalent.

Affected topology: c3-210 (agent-coordinator) owns session lifecycle + the stream
consumer where launches are observable.

## Decision

Mirror the proven `hasLiveWorkflow` guard with a `hasPendingBackgroundTask` guard, but
drive it from a deadline (Kanna has no per-id mid-flight completion signal in its entry
stream — the task-notification line itself produces no transcript entry).

1. Track launches in `ClaudeSessionState`: a `backgroundTaskIds: Set<string>` plus a
`backgroundTaskDeadlineAt: number`. In the stream consumer, when a `tool_result`
entry's content matches `Command running in background with ID: (<id>)`, add the id
and set `backgroundTaskDeadlineAt = now + resolveBackgroundTaskMaxMs()`.
2. `hasPendingBackgroundTask(session, now)` returns true while `backgroundTaskIds.size
0 && now < backgroundTaskDeadlineAt`; when the deadline has passed it lazily clears
the set (so the badge/log stay accurate). Consult it in both `isClaudeSessionIdle`
and `enforceClaudeSessionBudget`, exactly where `hasLiveWorkflow` is consulted.
3. Clear the guard at the start of a real `chat_send` turn (`startTurnForChat`): the
user is back, no need to hold the process for background polling.
4. `resolveBackgroundTaskMaxMs()` reads `KANNA_PTY_BACKGROUND_TASK_MAX_MS` (default
1_800_000 = 30 min) — comfortably longer than the 10-min idle window and typical CI.

Deadline (not completion) chosen because the `<task-notification>` line is not surfaced
as a Kanna transcript entry, so per-id completion is not observable without new IO; a
bounded deadline matches the "eventually reaps" philosophy of the workflow guard.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Adds background-task tracking fields to ClaudeSessionState, the launch-detection in the stream consumer, the hasPendingBackgroundTask guard, and wires it into the two idle/budget call sites it owns. c3-225 parser and c3-2 container contracts are unchanged (the task-notification + bg-launch strings already pass through unchanged) | Contract surface unchanged (internal lifecycle behavior); verify Change Safety row "Lost turn on crash" still holds via agent.test.ts |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | The guard must read no clock/IO beyond what the coordinator already does (Date.now() is passed in / already used); env read goes through the same process.env pattern as the existing lifecycle resolvers, no new fs/child_process | comply |
| ref-event-sourcing | Launch detection observes already-persisted transcript entries; it adds no new event kind and writes nothing to the log | comply |
| ref-provider-adapter | Guard is PTY-lifecycle-internal; no change to the provider-agnostic turn/transcript shape | comply |
| ref-colocated-bun-test | New behavior tested in the existing colocated agent.test.ts | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New ClaudeSessionState fields and the guard signature must be explicitly typed (Set<string>, number, boolean) — no any/untyped literals | comply |
| rule-colocated-bun-test | Tests for the guard + launch detection live in src/server/agent.test.ts next to agent.ts, run under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| State | Add backgroundTaskIds: Set<string> + backgroundTaskDeadlineAt: number to ClaudeSessionState; init in session creation | src/server/agent.ts:178 |
| Detection | In the stream consumer, parse tool_result content for Command running in background with ID: (\w+); add id + set deadline | src/server/agent.ts:2753 |
| Guard | hasPendingBackgroundTask(session, now) + resolveBackgroundTaskMaxMs(); consult in isClaudeSessionIdle (1428) and enforceClaudeSessionBudget (1467) | src/server/agent.ts:1424 |
| Clear | Clear set + deadline at startTurnForChat entry | src/server/agent.ts:1756 |
| Badge | getClaudeSessionStates reports "warming" (not "idle") while a bg task is pending | src/server/agent.ts:1346 |
| Env | KANNA_PTY_BACKGROUND_TASK_MAX_MS default 1_800_000 via positiveIntegerFromEnv | src/server/agent.ts:1148 |
| Docs | Document the env var + behavior in CLAUDE.md PTY section | CLAUDE.md |
| Tests | agent.test.ts: (a) launch keeps session non-idle past idleMs; (b) deadline expiry reaps; (c) chat_send clears; (d) no-launch turns reap normally | src/server/agent.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - <reason> | No C3 CLI / validator / schema / template change; this is a runtime-behavior ADR enforced by bun tests, not by a c3x underlay surface | c3x check clean post-change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.test.ts | Fails if a session with an open background task reaps before its deadline, or if a no-background session stops reaping | bun test src/server/agent.test.ts |
| bun run lint | Strong-typing + side-effect seal stay green (no new IO, typed fields) | bun run lint |
| CLAUDE.md PTY section | Documents KANNA_PTY_BACKGROUND_TASK_MAX_MS so the bound is discoverable | grep KANNA_PTY_BACKGROUND_TASK_MAX_MS CLAUDE.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Arm a Kanna-owned pending_background_task poll wake (mirror maybeArmPendingWorkflowWake) | More moving parts than needed: the task-notification already re-enters the agent through the continuous tail once the process survives; a poll wake would re-run CI checks from scratch and burn an agent-wake-cap slot for no benefit |
| Un-drop the auto-wake filter | Wrong target: the <task-notification> is isMeta != true and is NOT dropped today; #332 only filters genuine isMeta:true background wakes which must stay filtered |
| Per-id completion tracking by watching the *.output file mtime | Requires a new fs adapter (side-effect seal) for marginal gain; a bounded deadline is simpler and matches the workflow guard's "eventually reaps" model |
| Just raise DEFAULT_CLAUDE_SESSION_IDLE_MS | Punishes every idle session globally and still races a long CI run; the guard is scoped to sessions that actually have a pending background task |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A genuinely long background task (> max) still reaps before completing | Generous 30-min default, configurable via KANNA_PTY_BACKGROUND_TASK_MAX_MS; documented | Manual: set a low max in test, assert reap after deadline |
| A quick task pins a warm session up to max, wasting a resident slot under maxResident pressure | Bounded by deadline; cleared on next chat_send; maxResident still evicts other unprotected sessions | agent.test.ts deadline-expiry + clear-on-send cases |
| False-positive launch match from unrelated tool_result text | Pattern anchored to CC's exact Command running in background with ID: <id> string, which appears only in background-Bash results (grep confirms it never appears in src) | Unit test feeds a non-matching tool_result and asserts no guard |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts | pass (new background-task lifecycle cases + existing idle/budget cases green) |
| bun run lint | pass (no new warnings; side-effect seal + strong-typing clean) |
| bun test | pass (full suite) |
| c3x check | clean (no doc drift) |
