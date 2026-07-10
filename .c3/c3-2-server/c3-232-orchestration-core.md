---
id: c3-232
c3-seal: 6decbf5cea48cd26c55e85884554869dbac1e0eb475c0740187e84138723566a
title: orchestration-core
type: component
category: feature
parent: c3-2
goal: 'Drive durable, multi-task, multi-phase coding runs: create per-run git worktree pools, route tasks through an ordered phase pipeline, persist every state transition in the event store, and recover cleanly across server restarts.'
uses:
    - ref-colocated-bun-test
    - ref-cqrs-read-models
    - ref-event-sourcing
    - ref-local-first-data
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-strong-typing
---

## Goal

Drive durable, multi-task, multi-phase coding runs: create per-run git worktree pools, route tasks through an ordered phase pipeline, persist every state transition in the event store, and recover cleanly across server restarts.

## Parent Fit

| Field | Value |
| --- | --- |
| Parent container | c3-2 |
| Slot in Server | New sibling of c3-210 agent-coordinator; wired via OrchestrationQueueDeps |
| Responsibility handed up | Multi-task orchestrated runs with durable state and worktree isolation |
| Responsibility NOT handed up | Single-task subagent delegation (remains in c3-210) |

## Purpose

Owns: `src/server/orchestration-queue.ts` (OrchestrationQueue class), `src/server/orchestration-git.adapter.ts` (commitAll, diffAgainstBase), `src/server/orchestration-worktree.adapter.ts` (ensureWorktree, resetHard, removeWorktree), `src/shared/orchestration-types.ts` (pure types), and the 18-variant OrchestrationEvent extensions in events.ts / event-store.ts.

Does NOT own: single-task delegation (c3-210), WS command routing (c3-208), diff rendering (c3-215), event store infrastructure (c3-206).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Event store extension | 18 OrchestrationEvent variants at sourceIndex 8 (orch.jsonl); NOT folded into snapshot; pure replay only | c3-206 |
| Worktree pool (F13) | N worktrees pre-provisioned per run at orch/<runId>/wt-<i>; ensureWorktree is idempotent; heldByTaskId preserved across requeue | N.A - new component, no existing entity |
| Permit pool (F3) | rt.permits counter per run; separate from c3-210 permits; heldPermit boolean gates release in finally block | N.A - new component, no existing entity |
| Sync-apply atomicity | appendOrchestrationEvent applies event in-memory synchronously then enqueues disk write; single-process JS = no double-claim | c3-206 |
| Restart recovery | recoverOnStartup: requeue nonTerminalOrchTasks, rebuild pool via ensureWorktree, re-arm gated tasks, schedule via setTimeout(0) | N.A - new component, no existing entity |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| createRun | Validates OrchRunConfig, appends orch_run_created, provisions pool, appends orch_worktree_provisioned × N, seeds all tasks as orch_task_queued | c3-206 |
| Task scheduling | schedule() claims a free worktree slot (orch_task_claimed), spawns runTask per task | N.A - new component, no existing entity |
| Phase pipeline (F4) | Ordered OrchPhaseSpec list; each phase spawns fresh worker via StartWorker; {{TASK}}, {{DIFF}}, {{PRIOR}} template vars assembled by composePrompt | N.A - new component, no existing entity |
| Hand-back (F2) | After last phase: commitAll → orch_task_committed; on failure → orch_task_failed; on requeue → orch_task_requeued + resetHard | N.A - new component, no existing entity |
| Gate protocol (F5) | Hard gate: task enters orch_task_gated state, blocks in awaitGate until resolveGate; soft gate: emit events and continue | N.A - new component, no existing entity |
| Verify step (F12) | config.verify.command run post-completion; non-zero re-runs fix phase with output as {{PRIOR}}; exhausted → failed | N.A - new component, no existing entity |
| Cancel (AG1) | cancelRun sets rt.cancelled, aborts all AbortControllers, resolves gate resolvers, appends orch_run_cancelled | N.A - new component, no existing entity |
| waitForRun | Resolves to OrchRunSnapshot after terminal state (completed/cancelled/failed) | N.A - new component, no existing entity |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-event-sourcing | ref | All state mutations append events; state derived from replay | Primary | sourceIndex 8 orch.jsonl; NOT in snapshot |
| ref-cqrs-read-models | ref | orchRunsById is a read model; no mutation on write path | Primary | c3-206 |
| ref-local-first-data | ref | orch.jsonl stored under KANNA_HOME | Primary | No remote DB |
| ref-side-effect-adapter | ref | IO sealed in .adapter.ts leaves; queue + types are pure | Primary | Two adapter files |
| ref-strong-typing | ref | 18-variant discriminated union; Extract<> narrowing; no any/unknown | Primary | rule-strong-typing enforces |
| ref-colocated-bun-test | ref | Tests colocated next to source files | Primary | rule-colocated-bun-test enforces |
| adr-20260710-orchestration-core | adr | Authorizes this component; records design decisions, alternatives, risks | Authoritative | Proposed → accepted on PR merge |
| rule-colocated-bun-test | rule | Test files adjacent to source | Enforced | 3 test files |
| rule-strong-typing | rule | No any/unknown in new files | Enforced | ESLint + TypeScript |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| OrchestrationQueue.createRun(config) | IN | Validates OrchRunConfig, provisions worktrees, seeds tasks; returns runId string | Public API consumed by c3-208 | src/server/orchestration-queue.ts |
| OrchestrationQueue.waitForRun(runId) | OUT | Resolves to OrchRunSnapshot after terminal state | Async result to caller | src/server/orchestration-queue.ts |
| OrchestrationQueue.resolveGate(runId, taskId, approved) | IN | Unblocks gated task; returns boolean | Called by c3-208 on user approval | src/server/orchestration-queue.ts |
| OrchestrationQueue.cancelRun(runId) | IN | Aborts all in-flight workers; appends orch_run_cancelled | Only abort path; no other cancel path exists | src/server/orchestration-queue.ts |
| OrchestrationQueue.recoverOnStartup() | IN | Requeues non-terminal tasks, rebuilds pool, re-arms gates | Boot-time only; must run before any schedule() | src/server/orchestration-queue.ts |
| OrchestrationQueueDeps.store.appendOrchestrationEvent | IN/OUT | Sync-apply: event applied in-memory before disk write | Atomicity guarantee; single-process JS contract | c3-206 |
| StartWorker(args: WorkerSpawnArgs) | IN | Injected at construction; spawns task-specific worker; returns WorkerResult | IO boundary; queue stays pure | src/server/orchestration-queue.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Permit pool leak on gate resume | heldPermit boolean wrong; gate re-entry double-counts | Permit count drifts above initial; finishIfTerminal never fires | src/server/orchestration-queue.test.ts (permit-leak regression test) |
| Orphaned tasks after restart | recoverOnStartup misses nonTerminalOrchTasks or schedules synchronously | waitForRun hangs after restart | src/server/orchestration-queue.test.ts (restart-recovery test) |
| Double-claim | async gap in appendOrchestrationEvent breaks sync-apply contract | Multiple tasks claim same worktree slot | src/server/orchestration-queue.test.ts (parallel schedule tests) |
| FTS index corruption in c3.db | c3x mutations on malformed SQLite | c3x add fails with vtable error | Run c3x repair; retry |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/orchestration-queue.test.ts | ## Contract | Fake StartWorker; fake store; no real git | src/server/orchestration-queue.test.ts |
| src/server/orchestration-worktree.adapter.test.ts | ## Contract | Real git in temp dir; idempotency assertions | src/server/orchestration-worktree.adapter.test.ts |
| src/server/orchestration-e2e.test.ts | ## Business Flow | In-process; real worktrees; fake workers | src/server/orchestration-e2e.test.ts |
| CLAUDE.md Orchestration Core section | ## Purpose and ## Business Flow | Plain language; may omit low-level detail | adr-20260710-orchestration-core |
