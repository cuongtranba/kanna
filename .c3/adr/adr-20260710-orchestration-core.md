---
id: adr-20260710-orchestration-core
c3-seal: ea8221607058e7a9f68ca9b4132142a110ae4b4e9b06866ba01ae5c9e0f0e585
title: orchestration-core
type: adr
goal: Introduce a durable, event-sourced orchestration engine (`OrchestrationQueue`) that drives multi-task, multi-phase coding runs under Kanna. Each run isolates tasks in dedicated git worktrees, coordinates N parallel workers through an ordered phase pipeline (implement → review × 2 → fix), persists every state transition in the existing event store, and survives server restart without orphaned workers.
status: proposed
date: "2026-07-10"
---

## Goal

Introduce a durable, event-sourced orchestration engine (`OrchestrationQueue`) that drives multi-task, multi-phase coding runs under Kanna. Each run isolates tasks in dedicated git worktrees, coordinates N parallel workers through an ordered phase pipeline (implement → review × 2 → fix), persists every state transition in the existing event store, and survives server restart without orphaned workers.

## Context

Kanna's current `SubagentOrchestrator` drives one-shot or keep-alive single-task delegations with no structured phase ordering, no git isolation per task, and no durable recovery across restarts. Users want Claude to execute multi-task coding plans autonomously — each task on its own branch, reviewed before commit, with the server able to crash and resume mid-run. The existing event store (c3-206) already provides an append-only JSONL replay bus; extending it is the natural fit. `SubagentOrchestrator` is too narrow to host multi-task orchestration without collapsing its existing permit and delegation semantics.

## Decision

Implement `OrchestrationQueue` as a new component (`orchestration-core`) that lives alongside `SubagentOrchestrator` inside `agent-coordinator`'s dependency tree. It owns:

- **Worktree pool** (F13): N git worktrees pre-provisioned per run at `orch/<runId>/wt-<i>`.
- **Phase pipeline** (F4): ordered `OrchPhaseSpec` list; each phase spawns a fresh worker; `{{TASK}}`, `{{DIFF}}`, `{{PRIOR}}` template vars feed context forward.
- **Durable state** (F1/AG2/AG3): 18-variant `OrchestrationEvent` union appended to the existing event store at `sourceIndex 8`; events NOT folded into snapshot (pure replay only).
- **Permit pool** (F3): own `rt.permits` counter, separate from SubagentOrchestrator's.
- **Gate protocol** (F5): hard gates pause a task until `resolveGate`; soft gates emit and continue.
- **Verify step** (F12): post-completion command run; non-zero re-runs fix phase with output as `{{PRIOR}}`; exhausted → failed.
- **Restart recovery** (recoverOnStartup): requeue non-terminal tasks, rebuild pool idempotently, re-arm gated tasks, schedule deferred.
- **Cancel** (AG1): `cancelRun` is the sole path that aborts workers; sets `rt.cancelled`, aborts AbortControllers, resolves gates.

Sync-apply atomicity: `appendOrchestrationEvent` applies event in-memory synchronously then enqueues disk write. Single-process JS means no concurrent claim without explicit locking.

Git operations are encapsulated in two adapter leaves: `orchestration-git.adapter.ts` (commitAll, diffAgainstBase) and `orchestration-worktree.adapter.ts` (ensureWorktree, resetHard, removeWorktree), both exempt from the side-effect seal per the `.adapter.ts` convention.

Shared types live in `src/shared/orchestration-types.ts` (pure, no IO).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-2 | container | Parent container gains a new component; Responsibilities must record the addition | Parent Delta required |
| c3-206 | component | Gains 18 new OrchestrationEvent variants at sourceIndex 8; orchRunsById fold target added to StoreState; new query helpers added | Verify replay correctness; non-snapshot constraint |
| c3-210 | component | Will wire OrchestrationQueue into its dependency tree and expose createRun/cancelRun/resolveGate via WS router commands | Integration surface review |
| c3-3 | container | src/shared/orchestration-types.ts added; pure types, no IO | Confirm no side effects |
| c3-301 | component | OrchRunConfig, OrchTaskSpec, OrchPhaseSpec, OrchRunSnapshot, OrchWorktreeSlot, OrchTaskState exported | Strong-typing compliance |
| N.A - orchestration-core not yet in registry | N.A - registered in post-implementation C3 step | New component for orchestration-queue + adapter leaves | Will become c3-232 after c3x add |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | OrchestrationEvents appended to event store; replay must reconstruct full run state | comply |
| ref-cqrs-read-models | orchRunsById is a read model derived from event replay; must not mutate on the write path | comply |
| ref-local-first-data | orch.jsonl stored under KANNA_HOME; no remote DB | comply |
| ref-colocated-bun-test | Tests colocated as orchestration-queue.test.ts, orchestration-worktree.adapter.test.ts, orchestration-e2e.test.ts | comply |
| ref-side-effect-adapter | IO in adapter leaves only; queue + types stay pure | comply |
| ref-strong-typing | All exported types are concrete; no any/unknown in new files | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | All three new test files colocated next to their source | comply |
| rule-strong-typing | OrchestrationEvent is a 18-variant discriminated union; all helpers use Extract<> narrowing | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/orchestration-types.ts | Pure types: OrchTaskState, OrchRunConfig, OrchPhaseSpec, OrchTaskSpec, OrchRunSnapshot, OrchWorktreeSlot, defaults | commit addbf94 |
| src/server/events.ts | 18-variant OrchestrationEvent union (v:3), OrchRunRecord, OrchTaskRecord fold targets | commit 2a5c8de |
| src/server/event-store.ts | orchRunsById in StoreState, appendOrchestrationEvent, flush, getOrchRun, getOrchRuns, toOrchRunSnapshot, nonTerminalOrchTasks, gatedOrchTasks, getOrchTaskSpec, getOrchLastPhaseOutput, getOrchRunEvents, replayLogs sourceIndex 8, getReplayEventPriority returns 5 | commit 2a5c8de |
| src/server/event-store-orchestration.test.ts | 6 tests: run_created seeds queued; claim→phase→committed; requeue; restart replay (AG2); getOrchRunEvents; nonTerminalOrchTasks | commit 2a5c8de |
| src/server/orchestration-git.adapter.ts | commitAll + diffAgainstBase; delegates to diff-store runGit | commit 2ad040b |
| src/server/orchestration-worktree.adapter.ts | createOrchWorktreeOps(): ensureWorktree (idempotent), resetHard, removeWorktree, commitAll, diffAgainstBase | commit 2a68416 |
| src/server/orchestration-worktree.adapter.test.ts | 5 tests, 30s: create, resetHard, idempotent, commitAll+diff roundtrip, removeWorktree | commit 2a68416 |
| src/server/orchestration-queue.ts | OrchestrationQueue class; createRun, waitForRun, resolveGate, cancelRun, recoverOnStartup, getPermits; private schedule, runTask, awaitGate, composePrompt, runVerifyLoop, finishIfTerminal; detectScopeOverlap | commits 4d1902f → 9a787b4 |
| src/server/orchestration-queue.test.ts | 32 tests: scheduling, phase pipeline, hand-back, gates, scope overlap, gated restart re-arm, verify step, contextPrompt+scopePaths, cancel, restart recovery | commits built across Tasks 4–8 |
| src/server/orchestration-e2e.test.ts | 1 test, 60s: 4 tasks × 3 phases (implement+2×review+fix), real worktrees, AG3 event trail | commit 28cdef9 |
| .c3/ + CLAUDE.md | New component c3-232 orchestration-core, ADR adr-20260710-orchestration-core, CLAUDE.md section | this task |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| Component registry | c3x add component orchestration-core --container c3-2 | c3x read c3-232 returns goal + parent c3-2 |
| ADR registry | c3x add adr adr-20260710-orchestration-core | c3x read adr-20260710-orchestration-core returns status proposed |
| Container parent delta | c3x write c3-2 --section Responsibilities appended with orchestration-core line | c3x check shows no new errors for c3-2 |
| CLAUDE.md sync | "Orchestration Core (Plan A — engine only)" section appended | Section visible in CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run test --conditions production | 32 unit + 5 adapter + 1 e2e + 6 event-store tests must pass | 3051 pass, 0 fail on commit 28cdef9 |
| bun run lint | No warnings, no side-effect-seal violations in new files | exit 0 on commit 28cdef9 |
| c3x check | New component c3-232 registered; no new errors introduced by this change | verify after c3x add |
| Side-effect seal (ESLint) | orchestration-queue.ts, orchestration-types.ts contain no raw IO imports; adapters are .adapter.ts | lint passes |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Extend SubagentOrchestrator to host multi-phase runs | SubagentOrchestrator owns single-delegation semantics (keep-alive, one-shot, background). Adding phase ordering + worktree pool + per-run permit counters would bloat it past a single responsibility and risk breaking existing subagent delegation. |
| Store orchestration state in separate SQLite DB | Kanna already seals bun:sqlite/better-sqlite3 from production server code (side-effect seal). Adding a second DB layer violates the local-first + single-append-log architecture and creates dual-source consistency risk. |
| External job queue (Redis, BullMQ) | Kanna is a local-first single-process Bun server. External queues add operational complexity and a network dependency that conflicts with the offline-capable, single-binary distribution model. |
| Replay events into snapshot | sourceIndex 8 orch.jsonl events excluded from snapshot to keep snapshot small and fast; orchestration state is query-only at boot (recoverOnStartup) and then in-memory. Including in snapshot would bloat the 2MB compact threshold with transient run state. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Permit pool leak on gate resume | heldPermit boolean: false in resume path, set to true + rt.permits -= 1 after awaitGate returns; finally gated on if (heldPermit) rt.permits += 1 | permit-leak regression test in orchestration-queue.test.ts "gated restart re-arm" describe block |
| Orphaned tasks after restart | recoverOnStartup requeues all nonTerminalOrchTasks(); ensureWorktree is idempotent; schedule deferred to macrotask | restart-recovery test in orchestration-queue.test.ts |
| Double-claim without locks | Single-process JS + sync-apply: appendOrchestrationEvent applies in-memory synchronously before yielding | no concurrent fork; unit tests with parallel schedules confirm single claim |
| Worktree divergence | resetHard on orch_task_requeued; branch per task; base branch passed at createRun | diffAgainstBase roundtrip test in adapter test |
| E2E git credential prompt hanging tests | All git spawns set GIT_TERMINAL_PROMPT=0 and stdin: "ignore" with explicit 30s/60s timeouts | e2e + adapter tests pass in CI |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/orchestration-queue.test.ts | 32 pass, 0 fail |
| bun test --conditions production src/server/orchestration-worktree.adapter.test.ts | 5 pass, 0 fail |
| bun test --conditions production src/server/orchestration-e2e.test.ts | 1 pass, 0 fail |
| bun test --conditions production src/server/event-store-orchestration.test.ts | 6 pass, 0 fail |
| bun run test (full suite) | 3051 pass, 2 skip, 0 fail |
| bun run lint | exit 0, 0 warnings |
