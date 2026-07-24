---
id: adr-20260722-background-agent-keepalive
c3-seal: b853f5b748f4ddf46c1902b596657d3452a1ce588e2964a99dc0dfbaf211d8c4
title: background-agent-keepalive
type: adr
goal: |-
    Stop the idle reaper from killing a warm Claude session while a background
    Agent (Task tool) run is still in flight.
status: accepted
date: "2026-07-22"
---

# ADR — Background Agent keep-alive (extend the Bash-only guard)

## Goal

Stop the idle reaper from killing a warm Claude session while a background
Agent (Task tool) run is still in flight.

## Context — the silent death (chat dd05b76e, 2026-07-22)

A subagent-driven-development session launched Task implementers via the
native `Agent` tool in background. Timeline of the failure:

- 09:57:10 last Kanna-driven turn starts → `lastUsedAt` bumped for the last
time (only `startClaudeTurn`/session-reuse touched it).
- 10:02–10:07:42 the session self-woke on `<task-notification>`s (no Kanna
turn events, no `lastUsedAt` bump), then launched the Task 3 implementer in
background at 10:07:37.
- 10:09:16 idle eligibility reached (09:59:16 + 10 min); the 60 s sweep fired
≈10:09:50 and `closeClaudeSession` SIGKILLed the claude process — taking the
mid-flight background agent with it, one second after its `git commit`.
- On resume the CLI itself reported the orphan:
`task_notification { task_id: a6de6ce8…, status: "stopped" }`.

Two gaps compounded (same class as adr-20260604-pty-background-task-keepalive,
which fixed this for background *Bash* only):

1. `hasPendingBackgroundTask` armed only on the BashTool launch line
(`Command running in background with ID:`). The AgentTool launch text
(`Async agent launched successfully… agentId: <id>`) never matched.
2. `lastUsedAt` refreshed only on Kanna-driven turn starts, so a session
streaming self-wake turns looked idle to the reaper.

## How claude-code itself handles this (research, /home/cuong/repo/claude-code-qa)

- A first-class in-process task registry (`src/utils/task/framework.ts`);
the SDK run loop (`src/cli/print.ts`) holds `do…while(waitingForAgents)`
polling `getRunningTasks()` and starts its idle timer only after the loop
exits. Newer versions also hold back the final `result` while background
local_agent/local_workflow tasks run.
- The SDK exposes the registry to consumers as
`system/background_tasks_changed` — a LEVEL signal with REPLACE semantics
("swap your set for each payload; a missed bookend cannot wedge a stale
running indicator"). Shipped SDK 0.3.215 types + binary both carry it.
`task_notification` remains the terminal edge bookend per task.

## Decision

Three complementary changes, mirroring the upstream registry semantics:

1. **Level signal is the primary arm/clear (SDK driver).**
`claude-message-normalizer.ts` normalizes `background_tasks_changed` into a
hidden `status` entry carrying `backgroundTaskIdsSnapshot: string[]`
(StatusEntry, server-only field). The session runner REPLACES
`session.backgroundTaskIds` with each snapshot; deadline refreshes when
non-empty, zeroes when empty. `in_process_teammate` tasks are filtered out
(long-lived by design — claude-code gh-30008 excludes them from its own
wait loop for the same reason).
2. **Agent-launch regex joins the Bash regex** in
`backgroundTaskIdsFromToolResult` (`claude-prompt-helpers.ts`), gated on
the `Async agent launched successfully` marker. This is the ONLY launch
signal on the PTY driver (CLI ≥ 2.1.x writes no system rows to the
transcript JSONL) and a version-skew fallback on SDK. The existing
`task_notification` edge-clear and deadline backstop stay unchanged.
3. **Stream activity bumps `lastUsedAt`** — the runner sets
`session.lastUsedAt = Date.now()` on every appended transcript entry, so a
self-continuing session is never "idle" while visibly working (upstream's
idle-timer-after-run-loop invariant).

## Consequences

- Background Agent/Workflow/Bash runs all hold the session warm; a killed
settle notification is still bounded by the existing
`KANNA_PTY_BACKGROUND_TASK_MAX_MS` deadline backstop.
- The level snapshot is authoritative over both edges on the SDK driver;
duplicate arms from the regex fallback are harmless (Set semantics).
- PTY behaviour is unchanged except Agent launches now arm the guard.
