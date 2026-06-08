---
id: adr-20260608-pty-compact-boundary-dequeue-finalize
c3-seal: cba1028750728fdcdb98f680c22bc58b2f9be4276c353ff9c4cacf3fff5d3cd1
title: pty-compact-boundary-dequeue-finalize
type: adr
goal: |-
    Make the Kanna-injected proactive `/compact` turn finalize under the PTY
    driver so its `proactiveCompactInjection` active-turn entry is cleared once
    compaction completes. Today that turn never ends under PTY, leaving the
    in-memory `activeTurns` entry (and its `proactiveCompactInjection` flag)
    pinned forever, which makes `AgentCoordinator.dequeue()` permanently throw
    `"Cannot remove queued message while compact is running"` even after the
    compact has visibly run. The decision: treat the PTY `compact_boundary`
    transcript event as the compact turn's terminal signal and run the same
    turn-finalize + queue-drain path the SDK driver gets from its `result` event.
status: implemented
date: "2026-06-08"
---

## Goal

Make the Kanna-injected proactive `/compact` turn finalize under the PTY
driver so its `proactiveCompactInjection` active-turn entry is cleared once
compaction completes. Today that turn never ends under PTY, leaving the
in-memory `activeTurns` entry (and its `proactiveCompactInjection` flag)
pinned forever, which makes `AgentCoordinator.dequeue()` permanently throw
`"Cannot remove queued message while compact is running"` even after the
compact has visibly run. The decision: treat the PTY `compact_boundary`
transcript event as the compact turn's terminal signal and run the same
turn-finalize + queue-drain path the SDK driver gets from its `result` event.

## Context

Proactive compact (PR #134, `agent.ts` `chat_send` path) enqueues the user's
real message and starts a synthetic `/compact` turn, tagging the active turn
`proactiveCompactInjection = true`. `dequeue()` refuses to drop the queued
message while that flag is set so a 60s+ compact spend is not wasted.

The flag only clears when `runClaudeSession` deletes the active turn, which
happens on `event.entry.kind === "result"` with a matching prompt seq
(`agent.ts` ~line 2906). Under the SDK driver the `/compact` query ends with a
normal `result` (subtype `success`), so the turn finalizes and the queue
drains. Under the **PTY driver** the interactive TUI `/compact` slash command
writes only a `system/compact_boundary` line plus the continuation `user`
message — it never writes a `system/turn_duration` or `type:result` for the
compact (confirmed in a real transcript:
`~/.claude/projects/-Users-cuongtran-Desktop-repo-kanna/4f4df65b-...jsonl`
line 92 — `compactMetadata.trigger:"manual"` followed by the continuation
`user` line and `<command-name>/compact</command-name>`, with zero
`turn_duration`/`result` lines after it). The compact turn therefore never
finalizes: the active turn lingers, `dequeue()` is wedged, the compact prompt
seq is never shifted from `pendingPromptSeqs`, and the queued real message
never auto-drains. Affected topology is the turn-lifecycle owner c3-210
(agent-coordinator), specifically its PTY transcript-event handling.

## Decision

In the `runClaudeSession` event loop, when an `entry.kind === "compact_boundary"`
arrives while the active turn has `proactiveCompactInjection === true` AND the
resolved Claude driver is PTY, finalize the compact turn inline: mark
`hasFinalResult`, `recordTurnFinished`, reset `compactFailureCount` to 0,
splice the compact prompt's `claudePromptSeq` out of
`session.pendingPromptSeqs` (so a later real-turn result does not FIFO-mismatch
on the stale seq), `activeTurns.delete`, release the oauth-pool reservation,
then `maybeStartNextQueuedMessage` to drain the real message the compact made
room for. Gate strictly on `resolveClaudeDriverPreference() === "pty"` because
the SDK driver still relies on its trailing `result` event; finalizing on the
boundary there would double-finalize and corrupt the trailing result's seq
accounting. This mirrors the existing SDK `result` finalize block rather than
introducing a new lifecycle concept.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Owns turn lifecycle + PTY transcript-event handling in agent.ts; adds a compact_boundary finalize branch | Confirm turn-finalize parity with the SDK result path; colocated test added |
| ref-event-sourcing | N.A - no new event type; reuses existing turn_finished + queued_message events | N.A | N.A |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The fix branches on driver (PTY) for a behavior the SDK gets natively; must keep the normalized turn shape identical so the UI never branches on provider | comply |
| ref-event-sourcing | Finalize must go through existing store events (recordTurnFinished, setCompactFailureCount, queue drain) — no out-of-band state | comply |
| ref-colocated-bun-test | New regression test must sit next to agent.ts | comply |
| ref-tool-hydration | Cited by c3-210; the compact_boundary finalize emits no tool calls and does not touch tool normalization | N.A - tool hydration path untouched |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | The added regression test must be an agent.*.test.ts colocated with agent.ts under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/server/agent.ts | Add compact_boundary finalize branch in runClaudeSession, gated on proactiveCompactInjection + PTY driver | src/server/agent.ts runClaudeSession |
| src/server/agent.test.ts (or sibling) | Failing-first regression: PTY proactive compact + compact_boundary clears activeTurn, allows dequeue, drains queue | src/server/agent.*.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema surface changed by this decision | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.*.test.ts | Asserts compact_boundary under PTY finalizes the compact turn and unblocks dequeue | bun test src/server/agent.*.test.ts |
| AgentCoordinator.dequeue() | After finalize, proactiveCompactInjection is gone so dequeue no longer throws | runtime path in agent.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Delete the dequeue guard entirely (treat user X-click as explicit intent) | Leaves the underlying stuck compact turn — queue still never drains and chat stays "running"; only masks the symptom |
| Finalize on compact_boundary for both drivers | SDK still emits a trailing result; finalizing on the boundary double-finalizes and the trailing result shifts the wrong pendingPromptSeq, corrupting the next turn |
| Self-heal in dequeue() by reading store turn status | Under PTY the turn never records finished either, so store status is also "running" — the discriminator does not exist there |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| FIFO seq mismatch if compact seq left in pendingPromptSeqs | Splice active.claudePromptSeq out on finalize, same as cancel() does | Regression test asserts next turn completes; bun test |
| SDK regression from accidental boundary finalize | Strict resolveClaudeDriverPreference() === "pty" gate | Test covers SDK path unchanged; existing parity-matrix test stays green |
| Non-Kanna auto-compact mid normal turn finalizes wrongly | Branch requires proactiveCompactInjection flag, only set on Kanna-injected /compact | Test with auto-compact (no flag) does not finalize |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts (+ new sibling suite) | pass |
| bun run lint | pass, no new warnings |
