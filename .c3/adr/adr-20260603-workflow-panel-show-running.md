---
id: adr-20260603-workflow-panel-show-running
c3-seal: 50516dd9e402b9bb230279f707b60bbedd5810e2eb907ee48d302c11f8e17821
title: workflow-panel-show-running
type: adr
goal: Make the workflow status panel show an in-flight run as `running`. Today `WorkflowRegistry.snapshot(chatId)` returns only parsed `workflows/wf_<runId>.json` sidecars, which Claude flushes at/near termination — so the panel only ever lists terminal runs (killed/completed/failed) and never a live one. Surface a synthetic `running` row from the live run dir, and watch that dir so the row appears promptly at launch.
status: proposed
date: "2026-06-03"
---

## Goal

Make the workflow status panel show an in-flight run as `running`. Today `WorkflowRegistry.snapshot(chatId)` returns only parsed `workflows/wf_<runId>.json` sidecars, which Claude flushes at/near termination — so the panel only ever lists terminal runs (killed/completed/failed) and never a live one. Surface a synthetic `running` row from the live run dir, and watch that dir so the row appears promptly at launch.

## Context

`c3-229` watches `<session>/workflows` for terminal sidecars. The live run dirs `<session>/subagents/workflows/wf_*` (journal + agent jsonl) are written from second one. The idle-reaper fix (`adr-20260603-workflow-liveness-live-rundir`) already added `listWorkflowRunDirs` + `hasActiveRun` reading those dirs. This ADR reuses that same live signal for the panel read-model. Without a watch on the live dir root, a launched run (no sidecar yet) would not push a snapshot until it terminated, so the row would never appear while it matters.

## Decision

`snapshot(chatId)` merges sidecar runs with synthetic `running` rows: for each live run dir with no sidecar entry and activity within a 10-minute window, add `{status:"running"}` (sidecars always win — they carry the real terminal status + counts). Add adapter `watchWorkflowRunDirs(workflowsDir, cb)` (wraps `watchWorkflowDir` on the `liveRunRoot` sibling) and a registry `watchRunDirs?` dep; `register` arms both watches so a launch pushes a snapshot. Stale dirs past the window (crash with no sidecar) are dropped rather than shown forever-running. No client change — `WorkflowsSection` already renders the `running` status and guards missing counts.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-229 | component | snapshot now surfaces in-flight runs; adds watchWorkflowRunDirs adapter + watchRunDirs dep | Update Contract; comply cqrs/side-effect-adapter/strong-typing/ws-subscription + colocated-bun-test |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-cqrs-read-models | snapshot is the derived read pushed to the panel; synthetic running rows stay on the read path | comply |
| ref-ws-subscription | the live-dir watch drives the same workflows topic push as the sidecar watch | comply |
| ref-side-effect-adapter | the new watch is the existing .adapter.ts leaf (watchWorkflowRunDirs) | comply |
| ref-strong-typing | synthetic run uses the named WorkflowRun/WorkflowStatus types, no untyped literal | comply |
| ref-event-sourcing | read-model only; emits no event | N.A - read-model, not event path |
| ref-provider-adapter | no provider transcript change | N.A - not touched |
| ref-tool-hydration | no tool_use hydration change | N.A - not touched |
| ref-zustand-store | client unchanged (renders running already) | N.A - no client change |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | snapshot-running + watch-trigger tests colocated in workflow-registry.test.ts | comply |
| rule-strong-typing | typed synthetic run + adapter signatures | comply |
| rule-zustand-store | no client store touched | N.A - server-only |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Adapter | liveRunRoot(workflowsDir) + watchWorkflowRunDirs(workflowsDir, cb) wrapping watchWorkflowDir on the sibling | src/server/workflow-watch-io.adapter.ts |
| Registry | snapshot merges synthetic running rows (fresh live dir, no sidecar, sidecar wins); watchRunDirs? dep armed in register | src/server/workflow-registry.ts |
| Wiring | createWorkflowRegistry({ watchRunDirs: watchWorkflowRunDirs }) | src/server/server.ts |
| Tests | snapshot synth running / sidecar-wins / stale-drop / watch-notify | src/server/workflow-registry.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay touched | Read-model + adapter only | c3x check passes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| workflow-registry.test.ts snapshot tests | Fail if a fresh live run is not surfaced, a sidecar is overridden, or a stale dir lingers | bun test |
| bun run lint | Fails on side-effect-seal / any | CI |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Parse journal.jsonl for live agent counts | Heavier; the goal is only to SHOW the run is running — counts fill in from the sidecar at termination. |
| Poll instead of watch the live dir | A watch (already the registry's model) pushes promptly with no interval lag. |
| Show every live dir as running with no freshness | A crashed run with no sidecar would linger as forever-running in the panel. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Synthetic running row has no agentCount/tokens | Client guards missing counts (!= null); row shows status only until the sidecar lands | WorkflowsSection count guards; snapshot test |
| Crash with no sidecar lingers as running | 10-min freshness window drops stale live dirs | stale-drop test |
| Extra watch handle per chat | Disposed alongside the sidecar watch in unregister/re-register | register/dispose composition |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/workflow-registry.test.ts | 13 pass / 0 fail |
| bun run lint (changed files) | 0 errors |
| c3x check | structural PASS |
