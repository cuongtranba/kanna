---
id: adr-20260607-adr-20260607-pty-transcript-pure-poll
c3-seal: 6349bb8db1887831c5d6eed99dcfd3af06cd051db7c14b591a7882e6b9a6c0d2
title: adr-20260607-pty-transcript-pure-poll
type: adr
goal: |-
    Replace the hybrid `fs.watch` + 500 ms safety-net poll transcript follower in
    the claude-PTY driver with a single deterministic tail-poll loop, and fix a
    timer leak in the watch-failure fallback path. The decision being authorized is
    "how the PTY driver follows the on-disk transcript JSONL" — switching from a
    two-mechanism (kernel watch + backup poll) follower to one loss-proof `stat`-diff
    poll, since the file is append-only and the watch only ever served as a latency
    optimization whose unreliability already forced an always-on backup poll.
status: implemented
date: "2026-06-07"
---

## Goal

Replace the hybrid `fs.watch` + 500 ms safety-net poll transcript follower in
the claude-PTY driver with a single deterministic tail-poll loop, and fix a
timer leak in the watch-failure fallback path. The decision being authorized is
"how the PTY driver follows the on-disk transcript JSONL" — switching from a
two-mechanism (kernel watch + backup poll) follower to one loss-proof `stat`-diff
poll, since the file is append-only and the watch only ever served as a latency
optimization whose unreliability already forced an always-on backup poll.

## Context

`startFollowing` in `src/server/claude-pty/tui-source.adapter.ts` follows the
transcript with `node:fs` `watch(filePath, ...)`. Under Bun the backend is
**kqueue** on macOS and **inotify** on Linux (NOT FSEvents — Bun does not use
FSEvents; the existing code comment mislabels it). The watch callback carries no
data; it only wakes `readNewBytes`, which `stat`s the file, diffs `size` against
a `position` cursor, reads the new bytes, and splits on `\n`. Because the
transcript is append-only and `size` grows monotonically, the `stat`-diff read is
loss-proof on its own — the watch is pure latency reduction.

Two problems:

1. **Dropped turn-end rows.** Rapid appends at turn end (final `assistant` +
`system/turn_duration`) coalesce under the watch and the stream silently
stalls. This already forced an unconditional 500 ms `DEFAULT_SAFETY_POLL_MS`
running *alongside* the watch — i.e. the codebase already does not trust the
watch for correctness.
2. **Timer leak + degraded fallback.** In the non-poll branch the `catch`
(watch threw) assigns a 50 ms `pollTimer`, then the next line unconditionally
overwrites the `pollTimer` reference with the 500 ms safety timer. The 50 ms
interval is orphaned — `close()` only clears the last `pollTimer`, so it runs
forever; and the watch-failure case (where fast polling matters most) is left
on the slow 500 ms cadence.

Affected topology: c3-225 claude-pty-driver — specifically its transcript-source
adapter. The `KANNA_PTY_TRANSCRIPT_WATCH=fs|poll` env var (consumed at
`driver.ts:715`) selects between the two modes today.

## Decision

Drop `fs.watch` entirely. `startFollowing` becomes a single `setInterval`
tail-poll at `DEFAULT_POLL_INTERVAL_MS` (50 ms, the existing constant) calling
`readNewBytes`. Remove the `watcher` variable, the `node:fs` `watch` import, the
`pollMode` branch, the `pollMode` arg from `StartTranscriptStreamArgs`, and
`DEFAULT_SAFETY_POLL_MS`. `close()` clears the one `pollTimer`. This eliminates
the kqueue/inotify coalescing class of bug, the timer leak, the degraded
fallback, and platform divergence in one move, at the cost of ~50 ms worst-case
read latency (irrelevant for chat-turn cadence) and a negligible idle `stat`
every 50 ms on one local file. `KANNA_PTY_TRANSCRIPT_WATCH` is retired (stop
consuming it at `driver.ts:715`); documented as inert alongside the other retired
PTY flags. Pure poll is chosen over "keep watch + fix leak" because the watch's
only benefit (sub-50 ms latency) is unneeded and its presence is the sole source
of the drop bug the safety poll was bolted on to mask.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Owns tui-source.adapter.ts (transcript follower) and driver.ts (env wiring) being changed | Confirm JSONL-as-sole-event-source invariant preserved; record Parent Delta on container c3-2 |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | The transcript JSONL is the replayed event log; the follower must deliver every appended line without loss | comply — stat-diff poll on an append-only file is loss-proof by construction |
| ref-colocated-bun-test | Behavior change must be proven by the colocated test next to the adapter | comply — update tui-source.adapter.test.ts in the same dir |
| ref-provider-adapter | Governs SDK/Codex transcript normalization | N.A - this change touches only the byte-level follower, not the provider normalization layer |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | StartTranscriptStreamArgs is a boundary type crossing into the driver | comply — remove pollMode field cleanly, no any/unknown introduced |
| rule-colocated-bun-test | Tests must sit next to the file under test and run under bun test | comply — all edits land in the existing colocated tui-source.adapter.test.ts |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Adapter | Rewrite startFollowing to single poll; drop watcher, watch import, pollMode arg, DEFAULT_SAFETY_POLL_MS; simplify close() | src/server/claude-pty/tui-source.adapter.ts |
| Driver | Remove pollMode prop and KANNA_PTY_TRANSCRIPT_WATCH consumption | src/server/claude-pty/driver.ts:715 |
| Tests | Drop pollMode from test args; rename the "safety-net poll vs fs.watch drops" block to a pure-poll delivery test; add a close()-stops-polling assertion | src/server/claude-pty/tui-source.adapter.test.ts |
| Docs | Update "Transcript watch" note + Architecture note; move KANNA_PTY_TRANSCRIPT_WATCH to the retired-flags list | CLAUDE.md |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema / template / help surface is changed by this code-only decision | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| tui-source.adapter.test.ts poll-delivery test | Asserts appended lines after stream setup are delivered by the poll | bun test src/server/claude-pty/tui-source.adapter.test.ts |
| tui-source.adapter.test.ts close-stops-polling test | Asserts close() clears the timer (no leak) | same suite |
| bun run lint | node:fs watch import removed; no dead pollMode references | lint passes at --max-warnings=0 |
| parity-matrix.test.ts | SDK↔PTY event-sequence parity unaffected by follower mechanism | bun test src/server/claude-pty/parity-matrix.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep hybrid, only fix the timer leak | Leaves the kqueue/inotify coalescing drop bug and the dual-mechanism complexity the safety poll exists to paper over |
| Adopt chokidar | Banned by the side-effect seal, heavier dependency, and internally wraps the same fs.watch+poll tradeoff — no reliability gain |
| Use fs.watchFile (StatWatcher) | It is stat polling behind an indirection; the explicit setInterval already in the file is clearer and avoids a second mechanism |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Higher idle CPU from 50 ms polling | Single stat + partial read on one local file; cheaper than the 500 ms poll already running unconditionally today | bun test src/server/claude-pty/ green; manual PTY smoke |
| Read latency rises vs kernel watch | Capped at 50 ms; chat-turn cadence tolerates it; parity tests unaffected | bun test src/server/claude-pty/parity-matrix.test.ts |
| Missed bytes on file truncation/rotation | Append-only transcript invariant; readNewBytes returns when size <= position; one file pinned per session | existing "holds partial line across writes" test stays green |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/tui-source.adapter.test.ts | all tests pass |
| bun test src/server/claude-pty/ | all PTY suites pass |
| bun run lint | passes, no new warnings |
| grep -n "watch|pollMode" src/server/claude-pty/tui-source.adapter.ts src/server/claude-pty/driver.ts | no fs.watch import, no pollMode references remain |
