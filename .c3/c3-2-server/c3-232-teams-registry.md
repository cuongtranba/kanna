---
id: c3-232
c3-seal: 4cf83be37fd36456c5f5aeda8d0870f4120b45092cb17da893e6f375297ac9d4
title: teams-registry
type: component
category: feature
parent: c3-2
goal: Hold live per-chat Agent-SDK teammate task state and publish snapshots to the teams WS topic and panel.
uses:
    - ref-event-sourcing
    - rule-colocated-bun-test
    - rule-strong-typing
---

# teams-registry

## Goal

Hold live per-chat Agent-SDK teammate task state and publish snapshots to the teams WS topic and panel.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Orchestrate provider-agnostic agent turns and surface live read-models to the UI" |
| Category | feature |
| Lifecycle | Singleton in-memory registry, per-chat state, cleared on session close |
| Replaceability | Replaceable provided apply/snapshot/clear/subscribe contract preserved |

## Purpose

Owns the live view of native Agent-tool teammates (Agent SDK >= 0.3.x teams): consumes TeamTaskEvent harness events tapped from the SDK driver stream, folds them into per-chat TeamTaskSummary maps, and notifies subscribers so ws-router can push the teams topic. Also answers teammate-name lookups for approval-card attribution. Non-goals: persistence (in-memory only, restart amnesia accepted), PTY transcripts (no task events there), Workflow-tool runs (c3-229 owns those).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | SDK driver session streaming HarnessEvents | c3-210 |
| Input — task events | agent-coordinator taps {type:"task"} events into apply(chatId, event) | c3-210 |
| Input — clock | Injected now() dep (side-effect seal; no Date.now inside) | N.A - dependency injected at composition root |
| State | Map<chatId, Map<taskId, TeamTaskSummary>>, insertion order | N.A - internal in-memory structure |
| Shared dependency | TeamTaskSummary shape in shared types | c3-301 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | TeamsSection panel shows live teammate rows; approval cards carry teammate bylines | c3-112 |
| Primary path | task_started upsert running, task_progress bumps activity, task_updated/notification terminal status + endedAt | N.A - single-module fold, covered by colocated test |
| Alternate | Unknown-task or already-terminal events are silent no-ops (no notify) | N.A - covered by colocated test |
| Failure | Session close clears the chat state; stale-session events dropped by coordinator guard | c3-210 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | Read-model stays OUT of the event log (sibling read-model, in-memory) | normal | mirrors workflow-registry stance |
| rule-strong-typing | rule | TeamTaskEvent/TeamTaskSummary typed boundaries | always | shared types in src/shared/types.ts |
| rule-colocated-bun-test | rule | teams-registry.test.ts colocated | always | src/server/teams/teams-registry.test.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| apply(chatId, TeamTaskEvent) | IN | Folds lifecycle events; notifies only on state change | server-internal | src/server/teams/teams-registry.test.ts |
| snapshot(chatId) | OUT | Returns copied TeamTaskSummary[] (consumers cannot mutate state) | ws-router teams topic | src/server/teams/teams-registry.test.ts |
| clear(chatId) / subscribe(cb) | IN/OUT | Session-close reset; change notifications | agent-coordinator / ws-router | src/server/agent.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Render loop on client | Selector returns fresh refs | renderForLoopCheck test | bun test --conditions production src/client/app/TeamsSection.test.tsx |
| Stale rows after rotation | Missing clear/guard | teams-registry + agent tests | bun test --conditions production src/server/teams/teams-registry.test.ts src/server/agent.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/teams/teams-registry.ts | Contract, Business Flow | none | bun test --conditions production src/server/teams/teams-registry.test.ts |
| src/client/app/TeamsSection.tsx + src/client/stores/teamsStore.ts | Contract (snapshot shape) | presentation only | bun test --conditions production src/client/app/TeamsSection.test.tsx |
