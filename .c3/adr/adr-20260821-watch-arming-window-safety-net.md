---
id: adr-20260821-watch-arming-window-safety-net
c3-seal: 669d22fe5783f3aa125a0a2e2bb6a919e4fb5479e9583d47e37e6019d90aca98
title: watch-arming-window-safety-net
type: adr
goal: 'Close the arming-window drop in `watchWorkflowDir`: `fs.watch` does not begin delivering events at the instant `watch()` returns, so a write landing in that gap is silently lost and the cached snapshot never refreshes (measured 0/10 events delivered at a 0 ms gap). Schedule one `setTimeout(fire, 0)` safety-net fire on the target-arm path, collapsing with any real event via the existing debounce.'
status: done
date: "2026-08-21"
---

# adr-20260821-watch-arming-window-safety-net

## Status

Accepted

## Context

`watchWorkflowDir` is used by `watchTrackingFile` (loop-tracking read-model) and the workflow registry to follow on-disk files. When the watched directory exists, `armTarget()` calls `fs.watch(dir, ...)` and returns immediately — but the OS watcher does not start delivering events at the instant `watch()` returns. A write that lands in this gap is silently dropped and the cached snapshot is never refreshed.

Measured in issue #800 (probe against `watchTrackingFile`, 10 trials each):

| Gap between arm and write | Events delivered |
| --- | --- |
| 0 ms | 0/10 |
| 1 ms | 9/10 |
| 10 ms | 10/10 |

The same race caused the `loop-tracking-registry.test.ts` e2e test to fail intermittently: the test wrote the file synchronously after calling `syncLoopTracking`, and under whole-suite load the arming takes longer, so the write landed in the window more often.

The product impact is that the chat footer's Progress panel shows stale rows until the next write, because the registry never re-reads.

## Prior art

`watchWorkflowDir` already solves an analogous race for the parent-arm phase: when the watched directory does not exist yet, `armParent()` watches an ancestor and polls until the target dir appears (`parentPoll`), then calls `fire()` immediately in `promote()` to trigger an initial read. The exact reasoning is documented in the comment:

> "macOS FSEvents does not start delivering the instant `watch(ancestor)` returns, so a dir created in the race window between arming and first delivery is silently dropped."

`adr-20260607-pty-transcript-pure-poll` removed `fs.watch` from the PTY transcript follower entirely in favour of a 50 ms stat-poll for the same "poll beats OS watcher arming window" reason.

## Decision

After `armTarget()` is called from the `existsSync(dir)` branch (the target-arm path), schedule a single `deps.setTimeout(() => fire(), 0)` — a safety-net fire on the next event-loop turn. The debounce inside `fire()` ensures it collapses with any concurrent real watch event. This mirrors the `fire()` call in `promote()` for the parent-arm path.

The `promote()` path is unchanged: it already calls `fire()` immediately, so no double-fire is introduced there.

The e2e test in `loop-tracking-registry.test.ts` is changed to poll until the snapshot content matches the expected value, rather than sleeping a fixed 300 ms. This makes it resilient to timing regardless of load.

## Consequences

- Writes that land in the watcher's arming window are caught on the next event-loop turn instead of silently dropped.
- The Progress panel now reflects a worker's first append without waiting for a subsequent write to wake the watcher.
- The previously-flaky e2e test is now loss-proof: it waits for content, not for a notification at a fixed time.
- One extra `fs.readFile` per `register()` call (on the next tick) — negligible; loops arm infrequently.
