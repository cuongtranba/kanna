---
id: adr-20260911-loop-parallel-task-claims
title: Parallel loop workers claim tasks in the tracking file, and leases are bound to runs
type: adr
goal: Let an autonomous loop run several workers at once without two of them taking the same task or sharing a worktree, and without a dead worker stalling the loop forever.
status: accepted
date: 2026-09-11
---

## Goal

Let an autonomous loop run several workers at once without two of them taking the same task or sharing a worktree, and without a dead worker stalling the loop forever.

## Context

`setup_loop` accepted a `parallelism` option (1–4), but it only changed prompt wording. It was never persisted on `loop_armed`, so nothing at runtime knew a loop was parallel. Turning it up did not speed a loop up, it corrupted it: `append_tracking_row` and `replace_tracking_section` are read-modify-write with an `await` between read and write, so two workers finishing together silently lost one write; `## Next chunk` holds exactly one chunk by contract, so every worker got the same work; nothing recorded which worker owned which worktree; and real plans have foundations, so a flat queue hands out authentication before the user model exists.

## Decision

For `parallelism > 1` the skeleton drops `## Next chunk` and gains `## Task queue`, whose `[ ]` / `[~]` / `[x]` checkboxes are the concurrency control. A task is claimable only when it is `[ ]`, every id in its `needs:` list is `[x]`, and its worktree is not held by a lease whose run is still alive. Claims are atomic under a per-file in-process mutex, which is sufficient because every tracking-file write funnels through one server process.

**A lease is bound to the run that holds it, and reclaimed by liveness rather than by a clock.** `delegate_subagent` takes a `claim_id`; when the run launches, the server stamps `run: <runId>` onto the item. `claim_tracking_task` first releases every `[~]` whose run is absent from `store.getSubagentRuns(chatId)` or is no longer `running`. A wall-clock grace of two minutes survives only for a claim that never bound a run.

Integration is a server tool, `integrate_tracking_tasks`, which merges each finished task's branch into the integration branch and marks it `integrated`.

## Consequences

The decision table gains `WAIT` (nothing claimable, a live run holds a lease — end the turn, a finishing worker will wake it) and `QUEUE BLOCKED` (nothing claimable, no live run, unfinished tasks — a cycle, an unknown dependency, or a task with no worktree, which only a human can repair).

`MAX_PARALLELISM` is 3 rather than 4, because `DEFAULT_MAX_PARALLEL` is the whole server's subagent permit pool and exhausting it queues silently instead of failing. The failure budget scales as `MAX_CONSECUTIVE_LOOP_FAILURES + parallelism - 1`, since at a flat 3 one correlated failure burns the whole budget in a single round. A parallel loop refuses to arm on a git-tracked tracking file, because a merge that rolls back claim state is a merge that puts two workers in one worktree.

Two pre-existing defects had to be fixed for any of this to hold. `clearClaudeSessionContext` skipped the session close when the session was in use, so a worker completing during a sibling's wake-turn silently no-opped the `/clear` and the next orchestrator turn reused the previous turn's context; it now defers via `contextClearPending`, which `spawnClaudeTurn` honours as a respawn trigger. And the tracking tools' read-modify-write lost concurrent updates even in serial loops; `withFileLock` plus an atomic write-then-rename `writeDoc` closes that.

## Alternatives considered

**A wall-clock lease TTL as the primary recovery path — rejected, and this is the load-bearing rejection.** A worker that fails never calls `complete_tracking_task`, so its lease is still fresh at the moment its own failure-wake arrives. The orchestrator sees a live lease, takes `WAIT`, ends the turn, and nothing ever wakes that chat again, because only a run completion produces a wake. TTL expiry generates no wake, so the timer would never be read. A wall-clock TTL is also unsound in the other direction: the subagent run timeout is an inactivity timer, so a productive worker can outlive any fixed TTL and have its live task re-claimed into a shared worktree.

**Prompt-level git for integration — rejected.** The orchestrator is a fresh context every turn, which makes it the least reliable place for a multi-step stateful git operation.

**One schema for serial and parallel loops — rejected.** Serial loops keep `## Next chunk` and today's prompt byte-for-byte, so no armed loop changes behaviour and none of the serial prompt invariants move. `LOOP_PARALLEL_STEP_INVARIANTS` is therefore a separate, complete list.
