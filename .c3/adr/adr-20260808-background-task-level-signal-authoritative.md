---
id: adr-20260808-background-task-level-signal-authoritative
c3-seal: 35a153919537066f0f590f0a82c1165918af819445cc69122d930f4317afc724
title: background-task-level-signal-authoritative
type: adr
goal: |-
    Where the SDK emits its `background_tasks_changed` LEVEL signal, that signal is
    the sole authority on whether background work is running: set membership holds
    the session warm and no clock may expire it. The fixed keep-alive deadline and
    its wake ladder narrow to sessions that have no level signal — the PTY driver,
    an old CLI, or the window before an SDK session's first snapshot.
status: accepted
date: "2026-08-08"
---

# ADR — The SDK background-task level signal is authoritative

## Goal

Where the SDK emits its `background_tasks_changed` LEVEL signal, that signal is
the sole authority on whether background work is running: set membership holds
the session warm and no clock may expire it. The fixed keep-alive deadline and
its wake ladder narrow to sessions that have no level signal — the PTY driver,
an old CLI, or the window before an SDK session's first snapshot.

## Context

### The false wake (chat 1ed924dd, 2026-08-08)

A user asked the agent to "start the local dev". At 12:41:56 it launched a vite
dev server via `Bash(run_in_background)` → task `ba35e96q4`. At 13:14:39 Kanna
injected a raw `<background-task-check>` watchdog prompt into the chat, which
rendered as an ordinary user message. The task was perfectly healthy; the agent
duly checked it, found `status: running`, and reported "dev stack is still
running normally".

`backgroundTaskDeadlineAt` is refreshed only on EDGES — launch, settle,
`background_tasks_changed` snapshot, user `chat.send`, sweep re-arm. A dev
server produces none of them, so the 30-minute backstop
(`DEFAULT_PTY_BACKGROUND_TASK_MAX_MS`) lapsed on a healthy task and
`escalateExpiredBackgroundTaskGuard` spent a wake. The user's 12:44:23 message
re-armed the deadline; the wake landed 30.3 minutes later, to the second.

### Output growth is NOT a liveness signal — measured, not assumed

The obvious repair — refresh the deadline while the task's output file grows —
was tested against the machine and **refuted**:

- `…/tasks/ba35e96q4.output`: last mtime **12:45:04**, size **786 B**. The wake
fired at **13:14:39**, i.e. 29.5 minutes after the last output byte. Vite
prints its startup banner and then says nothing until a request arrives, so
an output-growth probe would have called this healthy server dead and woken
the user anyway.
- That `tasks/` directory contains only `<id>.output` files. There is no
claude-side status sidecar to read instead.

Any timer or activity heuristic fails the same way: silence is normal for the
single most common long-running background task there is.

### The authoritative signal already existed

The same session's transcript shows the SDK level signal working perfectly
throughout, with REPLACE semantics — every task appears and then correctly
disappears on settle:

```
["bb2war5fx"] → [] → ["bqrxqi0c7"] → [] → ["bs9yu2tvq"] → [] →
["b0blqptoy"] → ["b0blqptoy","boq06ye59"] → ["b0blqptoy"] → [] → ["ba35e96q4"]
```

`ba35e96q4` appeared and never left because the dev server never exited. The
signal was correct for the entire 32 minutes; the timer fired against it.

`@anthropic-ai/claude-agent-sdk@0.3.215`, `sdk.d.ts`
(`SDKBackgroundTasksChangedMessage`) prescribes exactly this use:

> "A **level signal**, unlike the task_started/task_notification edge bookends:
> consumers that only need 'is background work running' should **replace their
> set with each payload** rather than pairing edges, so a missed bookend cannot
> wedge a stale running indicator. […] The level is **per-process**: nothing is
> emitted at startup, so consumers must **reset to the empty set whenever the
> session's CLI process (re)starts** and let the next membership change
> repopulate it."

The SDK imposes no time limit on background tasks; their lifetime is the CLI
process lifetime. There is no upstream precedent for a ceiling.

This does not repeal `adr-20260801-background-task-wake-escalation`, which
remains accepted. That ADR replaced a *silent reap* with a *visible* escalation
and was right to. It could not distinguish a wedged task set from a quiet
healthy one because, on the information it consulted, the two are identical.
This ADR supplies the missing information.

## Decision

1. **`ClaudeSessionState.backgroundTasksLevelSourced`** — set to `true` by the
runner on the first `backgroundTaskIdsSnapshot` status entry. Sticky across
an emptied set (it records a driver capability, not a per-epoch fact) and
initialised `false` at every spawn, which satisfies the SDK's per-process
reset rule since `ClaudeSessionState` is in-memory and rebuilt per process.
2. **`hasPendingBackgroundTask`** returns true for any non-empty set on a
level-sourced session, ignoring the deadline. **`backgroundTaskGuardExpired`**
returns false for such a session, so the escalation ladder is unreachable.
3. **The launch regex does NOT promote.** `backgroundTaskIdsFromToolResult` is
the only launch signal on PTY; promoting on it would hand PTY sessions SDK
semantics they cannot support and disable their sole keep-alive bound.
4. **No absolute ceiling.** Following the SDK exactly: a task in the set keeps
the session warm until the SDK says it is gone.

### Consequences (part of the decision's expected behavior)

- A dev server, CI watch, or any silent long-running task no longer produces a
watchdog wake on the SDK driver. On a real SDK session `backgroundTaskWakeCount`
will now read `0` essentially always — that is the fix working.
- PTY behaviour is byte-for-byte unchanged: no level signal, so the deadline +
wake ladder + abandonment path govern exactly as before.
- **The two predicates no longer partition `size > 0`.** A level-sourced session
is simultaneously pending and un-expired — the "held indefinitely" state.
- **`enforceClaudeSessionBudget` loses its old bound.** Its comment claimed a
non-empty task set was protected "bounded by the sweep's wake cap"; for a
level-sourced set the bound is now the SDK's REPLACE semantics plus the
runner's `finally`, which deletes the session and releases the OAuth
reservation the instant the transport dies — so a crashed CLI still pins
nothing. A LIVE stream whose upstream task list wedges pins its session until
server restart. That is the accepted cost of trusting the signal the SDK tells
consumers to trust, and it was weighed against the alternative of waking users
about healthy dev servers several times a day.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | agent-coordinator owns the keep-alive guard and the session sweep being narrowed: backgroundTasksLevelSourced on ClaudeSessionState, both predicates in claude-session-lifecycle.ts, the promotion point in claude-session-runner.ts, the spawn default in claude-session-spawner.ts, and the (unchanged) ladder in claude-session-state-queries.ts | No new IO, no new deps, no config: the flag is an OBSERVED capability, not a configured one, so the side-effect seal and the deps builders are untouched |
| c3-2 | container | Server container hosts the idle reaper and budget enforcer whose keep-alive bound this ADR redefines; no protocol or client surface changes | Server-internal; no new transcript entry kinds, no WS topic changes |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-session-lifecycle.test.ts | level-sourced pending stays true past a lapsed deadline; guard never expires; empty set is not resurrected; no-level-signal path unchanged — pass |
| bun test src/server/claude-session-state-queries.test.ts | regression: a level-sourced session 32 min idle with a lapsed deadline fires no wake, no close, no abandonment (real hasPendingBackgroundTask wired, as production does); a non-level-sourced session still wakes — pass |
| bun test src/server/claude-session-runner.test.ts | first snapshot promotes; flag survives an emptying snapshot; a launch tool_result alone does not promote — pass |
| bun test src/server/agent.test.ts | coordinator integration: an SDK level-sourced task survives a sweep 2 h past idle with no <background-task-check> reaching the chat; the pre-existing launch-regex keep-alive/ladder test passes verbatim — pass |
| Negative control | With the two backgroundTasksLevelSourced early-returns removed, 4 of the new tests fail (3 unit + 1 integration). The tests bind to the fix, not to incidental state. |
| bun run test | full suite |
| bun run lint && bun run typecheck | ESLint --max-warnings=0; TS7 tsc --noEmit |
