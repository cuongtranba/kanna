---
id: adr-20260801-background-task-wake-escalation
c3-seal: e355b5a928c492138912acf5fd21f9c6e2dfa93ebf9e1aa67f595e58b6636381
title: background-task-wake-escalation
type: adr
goal: |-
    A pending background task must never die silently: when its keep-alive
    window lapses the session is WOKEN (agent re-checks and reports to the
    user), and any forced teardown posts a visible notice to the chat.
status: accepted
date: "2026-08-01"
---

# ADR — Background-task wake escalation (no silent deaths)

## Goal

A pending background task must never die silently: when its keep-alive
window lapses the session is WOKEN (agent re-checks and reports to the
user), and any forced teardown posts a visible notice to the chat.

## Context

### The silent death (chat 5a9e1d94, 2026-07-31)

A CI-fix session launched `Bash(run_in_background)` watching CI run
30647261910 (an `until … sleep 30` poll) at 16:28:32Z, then ended its turn.
Timeline of the failure:

- The launch armed `backgroundTaskDeadlineAt = launch + 30 min`
(`DEFAULT_PTY_BACKGROUND_TASK_MAX_MS`), the only refresh sources being
launch/settle edges and `background_tasks_changed` snapshots — all
EDGE-triggered. A quiet 30-min wait produces none of them.
- CI ran 33 min (queued on the busy single runner). At 16:58:32 the deadline
lapsed with the watch healthy and running.
- The 16:59:04 sweep called `hasPendingBackgroundTask`, which CLEARED the
guard as a side effect and returned false; the idle reaper closed the
session. The CLI killed the still-running watch child and enqueued
`<task-notification status=killed>` into a dying process.
- CI finished 17:01:42. Nobody was watching; the user was never told.

Two design flaws compounded (same class as
adr-20260604-pty-background-task-keepalive and
adr-20260722-background-agent-keepalive, which each fixed one arming gap
but kept the silent expiry):

1. The 30-min deadline is a FIXED backstop that expires healthy long tasks,
because nothing refreshes it during a quiet wait on either driver.
2. Expiry was handled inside a predicate (`hasPendingBackgroundTask`)
that mutated state and silently downgraded the session to reapable —
also reachable from the sidebar badge query as a read-path side effect.

A third silent-death path: a real `chat.send` CLEARED the guard outright
("agent is active again"), so any user message during a long watch led to a
silent reap ~10 min later.

## Decision

1. **`hasPendingBackgroundTask` is pure.** It reports `ids>0 && now<deadline`
and never mutates. New `backgroundTaskGuardExpired` (`ids>0 &&
now>=deadline`) is the sweep's escalation input.
2. **Sweep escalation instead of silent reap**
(`escalateExpiredBackgroundTaskGuard` in claude-session-state-queries):
Session busy (active turn / queued prompts / live workflow) → re-arm
the deadline, consume nothing.

Wake budget left (`backgroundTaskWakeCount < backgroundTaskMaxWakes`,
default 3, env `KANNA_BACKGROUND_TASK_MAX_WAKES`) → consume one wake:
re-arm and enqueue an agent-directed `<background-task-check>` prompt
through the normal queued-message path (warm-session reuse). The agent
reports results, posts a progress line, or TaskStops a stuck task —
every outcome is user-visible, and each check re-extends the keep-alive
by `backgroundTaskMaxMs`.

Budget exhausted AND time-idle → clear guard, close session, append a
visible abandonment notice (error result entry) to the chat. While the
last wake turn is still fresh, defer to the next sweep so an imminent
settle self-wake wins.

1. **User send re-arms, never clears.** `chat.send` refreshes the deadline
and restores the wake budget; pending ids are removed only by settle
edges / snapshots.
2. **Wake budget scopes to a watch epoch.** `backgroundTaskWakeCount` resets
when the id set transitions empty→non-empty (launch edge or snapshot) and
on user send.
3. **Budget eviction protects any non-empty id set** (including an expired
guard mid-escalation) — bounded by the wake cap, so a zombie set cannot
pin a session forever.

### Consequences (part of the decision's expected behavior)

- A 33-min CI watch now survives: wake #1 at ~30 min has the agent report
progress (user push notification), the settle self-wake at ~33 min
delivers the results. Worst-case pinning for a true zombie set is
`(maxWakes+1) × backgroundTaskMaxMs` (~2 h) with a visible check-in every
window and a visible abandonment notice at the end.
- The sidebar badge query no longer mutates guard state.
- PTY and SDK drivers share the escalation (it lives in the sweep).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | agent-coordinator owns the session sweep, keep-alive guard, and send path being changed: pure hasPendingBackgroundTask + backgroundTaskGuardExpired (claude-session-lifecycle.ts), sweep escalation (claude-session-state-queries.ts), user-send re-arm (claude-send-command.ts), wake/notify methods + KANNA_BACKGROUND_TASK_MAX_WAKES config (agent-coordinator.ts), backgroundTaskWakeCount on ClaudeSessionState | c3-210#n6962@v1:sha256:588b3966e9ff5b225b83ffadc7d415b18ed72d7e6c335864e521f7729832ec17 "Owns the agent turn lifecycle: receives chat.send commands, picks the provider via the catalog, drives the Codex/Claude adapter, normalizes streamed events in" | Sweep/deps stay side-effect sealed (IO only through injected deps); wake reuses the existing enqueueMessage → maybeStartNextQueuedMessage queued-message path rather than a new turn entry point |
| c3-2 | container | Server container hosts the idle reaper whose silent-expiry contract this ADR replaces with wake escalation; no protocol or client surface changes | c3-2#n6449@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Behavior change is server-internal; transcript entries produced (queued wake prompt, error result notice) use existing entry kinds |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-session-state-queries.test.ts | escalation ladder: wake with budget left, budget consumption across sweeps, visible abandonment at cap, busy re-arm without budget spend, empty-guard idle path unchanged — all pass |
| bun test src/server/claude-session-lifecycle.test.ts | hasPendingBackgroundTask returns false on expiry WITHOUT clearing ids/deadline (pure) — passes |
| bun test src/server/claude-send-command.test.ts | user send re-arms: ids kept, deadline refreshed by resolveBackgroundTaskMaxMs, wake budget restored — passes |
| bun test src/server/claude-session-runner.test.ts | wake budget resets on empty→non-empty (launch edge and snapshot), preserved within an epoch — passes |
| bun test src/server/agent.test.ts | coordinator integration: post-deadline sweep wakes and re-arms instead of closing; exhausted budget + time-idle closes with a visible notice naming the task id — passes |
| bun test src/server | 2973 pass / 0 fail (2 skip) |
| bun run lint && bun run typecheck | clean (ESLint --max-warnings=0; TS7 tsc --noEmit) |
