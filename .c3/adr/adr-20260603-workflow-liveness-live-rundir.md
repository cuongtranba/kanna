---
id: adr-20260603-workflow-liveness-live-rundir
c3-seal: c17fc13875dd251e5460a055b73052f1d581f5fd5598fc8d0a24cbcc0198ca33
title: workflow-liveness-live-rundir
type: adr
goal: 'Correct the workflow-liveness signal that `AgentCoordinator.hasLiveWorkflow` relies on. The prior ADR (`adr-20260603-workflow-aware-idle-reaper`) guarded the idle reaper on `WorkflowRegistry.snapshot(chatId)` finding a run with `status: "running"`. Empirically that signal is blind during the run: Claude writes the `workflows/wf_<runId>.json` sidecar only at/near termination, so for the entire live window the snapshot has no running run and the guard never fires — the PTY is still reaped mid-run. Switch liveness to the live transcript dir `subagents/workflows/wf_<runId>/` (written from second one) and add a wake-delay clamp so a re-entry always beats the reaper even if the file probe misses.'
status: implemented
date: "2026-06-03"
---

## Goal

Correct the workflow-liveness signal that `AgentCoordinator.hasLiveWorkflow` relies on. The prior ADR (`adr-20260603-workflow-aware-idle-reaper`) guarded the idle reaper on `WorkflowRegistry.snapshot(chatId)` finding a run with `status: "running"`. Empirically that signal is blind during the run: Claude writes the `workflows/wf_<runId>.json` sidecar only at/near termination, so for the entire live window the snapshot has no running run and the guard never fires — the PTY is still reaped mid-run. Switch liveness to the live transcript dir `subagents/workflows/wf_<runId>/` (written from second one) and add a wake-delay clamp so a re-entry always beats the reaper even if the file probe misses.

## Context

Re-verified on session `de4c6a76`, run `wf_9b307764` (deployed v0.82.1 with the prior fix): launched 21:49:25, agent `*.jsonl` files written live every ~30s, but `workflows/wf_9b307764.json` stayed absent until the PTY was killed at ~22:00:13 (turn end + ~600s idle), at which point the sidecar appeared with `status:"killed"`. All 7 panel runs were terminal because the registry only ever sees terminal sidecars. So both the #358 panel and the prior `hasLiveWorkflow` are blind for the run's whole life.

On disk Claude maintains TWO artifacts per run: the terminal summary `<session>/workflows/wf_<runId>.json` (flushed late) and the live `<session>/subagents/workflows/wf_<runId>/` dir (`journal.jsonl` + `agent-*.jsonl`, appended continuously). The registry (`c3-229`) already watches the former. The reaper/budget enforcer (`c3-210`) need a signal valid DURING the run — the latter.

Compounding: the #357 harvest prompt tells the model to "call schedule_wakeup to wait longer", so it sets ~1200s wakes > the 600s idle window, and #357's `if (live !== null) return` guard suppresses the protective 120s `pending_workflow` wake — so even the wake path cannot save the run.

## Decision

Liveness = the live run dir, not the terminal sidecar. Add adapter `listWorkflowRunDirs(workflowsDir)` returning `{runId, newestMtimeMs}` for each `subagents/workflows/wf_*` dir, and `WorkflowRegistry.hasActiveRun(chatId, freshnessMs, now)`: a run is live when its dir saw activity within `freshnessMs` AND has no terminal sidecar yet (absent, or status still `running`). The terminal sidecar is Claude's authoritative death signal; the freshness window is the belt for a hard crash that never wrote one. `hasLiveWorkflow` calls `hasActiveRun(chatId, idleMs, now)`; the idle/budget guards from the prior ADR are unchanged. Additionally clamp `scheduleAgentWakeup` delay to `idleMs - 60s` (floor 30s) so a wake always re-enters before the reaper — defense-in-depth if the file probe is ever stale.

This keeps the read-model/CQRS shape (lazy read, no new event), reuses the registered workflows dir to locate its `subagents/workflows` sibling, and adds no new IO outside the existing `.adapter.ts` leaf.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-229 | component | Gains WorkflowRegistry.hasActiveRun + adapter listWorkflowRunDirs (live-run-dir probe) as new public surface | Update Contract rows; comply with cqrs/side-effect-adapter/strong-typing refs + colocated-bun-test |
| c3-210 | component | hasLiveWorkflow rewired to hasActiveRun; scheduleAgentWakeup clamps delay to the idle window | Comply with event-sourcing + strong-typing + colocated-bun-test; tests in agent.test.ts |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-cqrs-read-models | hasActiveRun is a derived read over the registry's run dirs + sidecars; stays on the read path | comply |
| ref-side-effect-adapter | New node:fs calls (statSync/readdirSync) live in workflow-watch-io.adapter.ts, the exempt leaf | comply |
| ref-strong-typing | New WorkflowRunDirInfo type + hasActiveRun signature are named types across the coordinator↔registry boundary | comply |
| ref-event-sourcing | Guard only reads; the clamp adjusts an existing auto_continue_accepted field, emits no new event kind | comply |
| ref-colocated-bun-test | New behavior in c3-210/c3-229 gets colocated *.test.ts next to each file under test | comply |
| ref-provider-adapter | No provider transcript normalization change | N.A - not touched |
| ref-tool-hydration | No tool_use hydration change | N.A - not touched |
| ref-ws-subscription | No WS envelope/topic change (panel surface unchanged this ADR) | N.A - not touched |
| ref-zustand-store | No client store change | N.A - server-only |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | New behavior gets colocated tests: workflow-watch-io.adapter.test.ts, workflow-registry.test.ts, agent.test.ts | comply |
| rule-strong-typing | WorkflowRunDirInfo + hasActiveRun typed; no untyped boundary literals | comply |
| rule-zustand-store | No client Zustand store touched | N.A - server-only |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Adapter | listWorkflowRunDirs(workflowsDir) → WorkflowRunDirInfo[] from ../subagents/workflows/wf_* with max-mtime | src/server/workflow-watch-io.adapter.ts |
| Registry | dep listRunDirs? + hasActiveRun(chatId, freshnessMs, now) (fresh dir AND no terminal sidecar) | src/server/workflow-registry.ts |
| Coordinator | hasLiveWorkflow → hasActiveRun(chatId, idleMs, now); clamp scheduleAgentWakeup delay to idleMs - WAKE_GUARD_BUFFER_MS (min 30s) | src/server/agent.ts |
| Wiring | createWorkflowRegistry({ listRunDirs: listWorkflowRunDirs }) | src/server/server.ts |
| Tests | adapter dir-list, registry hasActiveRun matrix (fresh/terminal/running/stale/legacy), agent idle+budget guards, wake clamp | *.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay touched | Runtime + read-model logic only; no c3x command/validator/schema/template change | c3x check passes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| workflow-registry.test.ts hasActiveRun matrix | Fails if liveness misclassifies fresh-no-sidecar / terminal / running / stale / legacy | bun test |
| agent.test.ts idle+budget guard | Fails if a live-workflow session is reaped or evicted | bun test |
| agent.test.ts wake clamp | Fails if a >idle delay is not clamped below the idle window | bun test |
| bun run lint | Fails on side-effect-seal / any violations | CI |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the sidecar status:"running" signal (prior ADR) | Empirically blind: sidecar is written only at/near termination, so the guard never fires during the run — the bug the prior fix was meant to solve still reproduced (run killed at 10-min idle). |
| Parse journal.jsonl started/result delta for in-flight count | Heavier per-sweep parse; dir mtime + terminal-sidecar absence is cheaper and the terminal sidecar already gives a precise death edge. |
| Clamp only, no live-dir signal | Clamp alone keeps the kill-resume churn (each kill loses in-flight agents); the live-dir guard prevents the kill outright. Clamp is the belt, not the primary fix. |
| Bump lastUsedAt from the watcher | Couples the read-model into the write-path heartbeat; fragile to watch latency and leaves budget eviction unguarded. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Hard crash leaves a run dir with no terminal sidecar | The freshnessMs window (= idleMs) reaps it once activity stops for one idle window | registry stale-window test |
| A long single-agent phase writes no files for > idleMs and is misjudged dead | mtime is taken over ALL run-dir files incl. the agent's own appended jsonl; agents stream tool output continuously, so a full idle window of silence is itself an idle-worthy state | registry fresh/stale tests; live monitor showed ~30s write cadence |
| Clamp shortens the model's chosen poll, using more wakes against the cap | Acceptable: correctness over token economy; cap resets on a human turn; primary defense (live-dir guard) means most wakes are not the only thing keeping the PTY alive | wake clamp test |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/workflow-watch-io.adapter.test.ts src/server/workflow-registry.test.ts src/server/agent.test.ts | 113 pass / 0 fail |
| bun run lint (changed files) | 0 errors |
| c3x check --include-adr | PASS |
