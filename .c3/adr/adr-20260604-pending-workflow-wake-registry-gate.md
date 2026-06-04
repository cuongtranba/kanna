---
id: adr-20260604-pending-workflow-wake-registry-gate
c3-seal: 3b333c43bdb9d94cb545968f3df172646c06c99e825b2c0608b68053287e8194
title: pending-workflow-wake-registry-gate
type: adr
goal: |-
    Stop the `pending_workflow` harvest wake from re-arming forever after the
    background Workflow has actually finished. Gate `maybeArmPendingWorkflowWake` on
    the authoritative disk-watch `WorkflowRegistry` liveness (`hasLiveWorkflow`),
    not solely on Claude Code's per-turn `pendingWorkflowCount`, which stays > 0
    after the run is done and currently drives an endless re-arm loop.
status: implemented
date: "2026-06-04"
---

## Goal

Stop the `pending_workflow` harvest wake from re-arming forever after the
background Workflow has actually finished. Gate `maybeArmPendingWorkflowWake` on
the authoritative disk-watch `WorkflowRegistry` liveness (`hasLiveWorkflow`),
not solely on Claude Code's per-turn `pendingWorkflowCount`, which stays > 0
after the run is done and currently drives an endless re-arm loop.

## Context

Symptom (sessions `de4c6a76` 14×, `5f78aa43` 10×): the harvest prompt
"A background Workflow was running when your last turn ended (N pending).
Harvest from the working tree … If the workflow is still running, call
schedule_wakeup …" is re-queued again and again and never clears, even after the
model has repeatedly stated "No workflow running. Work complete — nothing
pending."

Evidence from `de4c6a76` transcript: `result` entries keep carrying
`pendingWorkflowCount=1` (e.g. ts 1780531224209, 1780532031060, 1780532190141)
interleaved with assistant text "No background workflow running (CI monitor
finished, ext wave stopped earlier)". So Claude Code's `system/turn_duration`
`pendingWorkflowCount` is STALE — it reports pending workflows that have already
terminated.

`maybeArmPendingWorkflowWake` (`agent.ts:3496`) arms whenever
`entry.pendingWorkflowCount > 0` and no schedule is already live. Each replayed
harvest turn ends with another stale `pendingWorkflowCount>0` → another arm →
the loop runs for hours (14 wakes over ~12h in `de4c6a76`), bounded only by
`KANNA_MAX_AGENT_WAKES` (25) which itself resets on every real user turn.

Kanna already has the authoritative liveness source: the disk-watch
`WorkflowRegistry`. `hasActiveRun(chatId, freshnessMs, now)` returns false the
moment a terminal `wf_<runId>.json` sidecar exists (status completed / killed /
failed), independent of the freshness window. `hasLiveWorkflow` (`agent.ts:1424`)
already wraps it and is consulted by the idle reaper / budget enforcer.

Affected topology: c3-210 (agent-coordinator), which owns both the arm logic and
the `hasLiveWorkflow` accessor.

## Decision

Add one guard to `maybeArmPendingWorkflowWake`: after the `count > 0` check and
before arming, `if (!this.hasLiveWorkflow(chatId)) return`. CC's stale
`pendingWorkflowCount` is treated as a HINT that there *may* be a pending
workflow; the registry is the authority on whether one is *actually still
running*. When the registry shows no live run (terminal sidecar present, or no
run dir), the wake is not armed and the loop terminates.

This reuses the exact accessor (`hasLiveWorkflow`) and authority the idle reaper
uses, keeping the two lifecycle decisions consistent. The first arm (workflow
genuinely running, dir freshly written) is unaffected because `hasActiveRun`
returns true while no terminal sidecar exists.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | maybeArmPendingWorkflowWake (owned by agent-coordinator) gains a hasLiveWorkflow gate; no Contract surface changes, internal lifecycle behavior only. The registry read it now also depends on is the same one c3-210 already consumes via c3-229 | Verify Business Flow "pending_workflow harvest" still arms on a live run and now stops on a terminal run via agent.test.ts |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | The arm still emits an auto_continue_accepted event through the existing event-sourced ScheduleManager; no new event kind | comply |
| ref-provider-adapter | Behavior stays PTY-internal (pendingWorkflowCount is a TUI turn_duration field; workflowRegistry is PTY-only); no provider-agnostic contract change | comply |
| ref-colocated-bun-test | New regression test sits in the existing colocated agent.test.ts | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | The guard uses the already-typed hasLiveWorkflow(chatId: string): boolean; no new untyped values | comply |
| rule-colocated-bun-test | Regression test lives in src/server/agent.test.ts under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Guard | Add if (!this.hasLiveWorkflow(chatId)) return after the count check in maybeArmPendingWorkflowWake | src/server/agent.ts:3496 |
| Tests | Update the existing arm test to inject a fake registry reporting active; add a regression test asserting NO arm when the registry shows no live run despite pendingWorkflowCount>0 | src/server/agent.test.ts:3363 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - <reason> | No C3 CLI / validator / schema / template change; runtime-behavior ADR enforced by bun tests | c3x check clean post-change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.test.ts | Fails if a stale pendingWorkflowCount>0 arms a wake when the registry reports no live run, or if a genuinely live run stops arming | bun test src/server/agent.test.ts |
| bun run lint | Strong-typing + side-effect seal stay green | bun run lint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Trust CC's pendingWorkflowCount and add a separate "is it really done" probe inline | That probe IS hasLiveWorkflow; adding it ad hoc duplicates the existing accessor and risks divergence from the idle reaper's notion of liveness |
| Cap re-arms harder (lower KANNA_MAX_AGENT_WAKES) | Treats the symptom, not the cause; still loops up to the cap and the cap resets on every real user turn, so it still spams over a session |
| Clear the schedule on workflow completion via a registry subscription | Larger surface (new subscription wiring) for the same outcome the guard achieves at arm time; arm-time gate is the minimal fix |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Registry lag at turn-end suppresses a legitimate first arm (regress #357) | hasActiveRun checks activity within a full idle window (~10 min) and returns true while no terminal sidecar exists; at turn-end right after a Workflow launch the dir is freshly written, so the live case still arms | agent.test.ts: live-registry arm case stays green |
| workflowRegistry absent (SDK driver / cold construction) → never arms | pending_workflow + pendingWorkflowCount are PTY-with-registry-only features; under SDK there are no turn_duration frames and no workflow panel, so suppression is correct | Existing no-registry tests now inject a fake registry where they assert arming |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts | pass (arm-on-live + no-arm-on-terminal regression + existing cases) |
| bun run lint | pass |
| c3x check | clean |
