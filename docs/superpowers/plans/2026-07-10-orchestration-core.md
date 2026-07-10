# Orchestration Core (Plan A of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A durable, restart-recoverable orchestration engine (Bun-in-Rust pattern): a global task queue where N configurable parallel workers claim tasks into a pre-provisioned **worktree pool**, driving each task through a configurable phase pipeline (implement → adversarial review → fix), with every state transition persisted as an event.

**Architecture:** New `OrchestrationQueue` engine layered as a sibling of `SubagentOrchestrator` (NOT inside it) with its own permit pool. State lives in a new `orch.jsonl` event log in the existing `EventStore` (sourceIndex 8, pure log replay, not in snapshot — same as `tool-requests.jsonl`). Workers are an injected port (`startWorker`) — this plan tests with fakes; Plan B wires real Claude workers via `buildSubagentProviderRun`. Git operations go through a new leaf `orchestration-git.adapter.ts` + the existing `worktree-store.adapter.ts`. Plan C adds the WS topic + UI panel.

**Ratified design (okra run `orchestration-20260710`):**
- F1: **global run entity** — events carry `runId`, no `chatId`.
- F2: restart → **re-queue with progress kept**, owner cleared, worktree slot binding preserved for reuse.
- F3: **own permit pool** (`maxParallelTasks`, default 4, configurable) — never touches SubagentOrchestrator permits.
- F4: **fresh worker spawn per phase** — adversarial reviewers get diff-only context by construction.
- F13: **worktree pool** — `worktreePoolSize` worktrees pre-provisioned + env-inited at `createRun` (branch `orch/<runId>/wt-<i>`); workers NOT pinned. Scheduler claims task + free slot atomically (sync-apply within one event-loop turn — single-process JS, no locks). Commits from multiple tasks stack on the worktree's branch; each task's review `{{DIFF}}` is anchored at the per-claim `baseSha`, never `baseBranch`. Slot released on committed/failed; kept HELD across handed_back/requeue so uncommitted progress survives (F2). Terminal failure resets uncommitted junk (`git reset --hard`) before release.
- F14: **PR per worktree** — run end leaves all pool worktrees in place for user inspection; the user triggers PR creation per worktree branch (Plan B `gh` port + Plan C button). N worktrees = N PRs.
- Anti-goals (tripwires, all must stay 0): AG1 no worker killed without explicit cancel; AG2 zero orphaned tasks after restart; AG3 zero state transitions without a persisted event; AG4 lint+test green every commit.

**Tech Stack:** Bun, TypeScript (strict — no `any`), bun:test colocated, existing EventStore JSONL infra, git worktrees via existing adapters.

**Task state machine (all arrows are persisted events):**

```
queued --orch_task_claimed--> claimed --orch_phase_started--> running
running --orch_phase_completed--> running (next phase)
running --orch_gate_opened(hard)--> gated --orch_gate_resolved(approve)--> running (next phase)
gated --orch_gate_resolved(reject)--> (orch_task_failed) failed
running --orch_task_committed--> committed   (terminal)
running --orch_task_failed--> failed         (terminal)
running/claimed --orch_task_requeued--> queued  (handed_back | restart_recovery)
```

**Gates (ratified F5):** a `hard` gate after a named phase pauses the task in
`gated` (durable, survives restart — re-armed on boot, resumes at the next
phase with the persisted prior-phase output) until `resolveGate` is called; a
`soft` gate emits the gate events and continues immediately (observable flag).
Gates pause BETWEEN phases only — never abort an in-flight worker (AG1). A
gated task keeps its permit slot (conservative v1; starvation surfaces in the
panel). **scopePaths (ratified F6):** overlapping task scopes at run creation
emit a soft `orch_scope_overlap_flagged` event — never a refusal.

**Repo rules that bind every task:** side-effect seal (IO only in `*.adapter.ts` / test files), strong typing (no `any`/`unknown`), `bun test --conditions production`, tests spawning git need explicit 30s timeout, commits only after green.

**Execution setup:** create an isolated worktree first via `superpowers:using-git-worktrees` skill, branch `feat/orchestration-core`, based on latest `main`. PR targets `cuongtranba/kanna` `main` (never upstream).

---

### Task 1: Shared orchestration types

**Files:**
- Create: `src/shared/orchestration-types.ts`

No behavior — types only, verified by `tsc` via lint in Task 2's test run. One commit.

- [ ] **Step 1: Write the types file**

```ts
// src/shared/orchestration-types.ts
import type { AgentProvider } from "./types"

/** Task lifecycle. Every transition is a persisted OrchestrationEvent (AG3). */
export type OrchTaskState =
  | "queued"
  | "claimed"
  | "running"
  | "gated"
  | "committed"
  | "failed"

export type OrchGateKind = "soft" | "hard"

/**
 * Checkpoint after a named phase. `hard` pauses the task in `gated` until
 * resolveGate; `soft` emits the gate events and continues (observable flag).
 * Gates sit BETWEEN phases — they never abort an in-flight worker (AG1).
 */
export interface OrchGateSpec {
  afterPhase: string
  kind: OrchGateKind
}

export type OrchGateDecision = "approve" | "reject"

export type OrchRunStatus = "running" | "completed" | "cancelled"

export type OrchPhaseKind = "implement" | "review" | "fix"

/**
 * One phase of the per-task pipeline. `parallel` > 1 fans out that many
 * fresh workers concurrently (adversarial review); their outputs are joined.
 * `promptTemplate` placeholders: {{TASK}} = task prompt, {{PRIOR}} = combined
 * output of the previous phase, {{DIFF}} = worktree diff vs base branch
 * (fetched only when the template contains it).
 */
export interface OrchPhaseSpec {
  name: string
  kind: OrchPhaseKind
  parallel: number
  promptTemplate: string
  /**
   * Worker policy (ratified amendment B): which provider/model executes this
   * phase (e.g. cheap model for review fanout, strong for implement/fix).
   * Optional — Plan B's real StartWorker falls back to its own default when
   * absent; fakes ignore it.
   */
  provider?: AgentProvider
  model?: string
}

export interface OrchRunConfig {
  title: string
  /** Absolute path to the git repo the run operates on. */
  repoRoot: string
  /** Base branch worktree branches fork from. Default "main". */
  baseBranch: string
  /** Own permit pool size — concurrent tasks in flight (F3). */
  maxParallelTasks: number
  /**
   * Worktree pool size (F13) — worktrees pre-provisioned at createRun, each on
   * its own branch orch/<runId>/wt-<i>. Tasks borrow a free slot; effective
   * concurrency = min(maxParallelTasks, worktreePoolSize). One PR per
   * worktree branch at the end (F14).
   */
  worktreePoolSize: number
  /** Max claim attempts per task before it fails terminally. */
  maxAttempts: number
  phases: OrchPhaseSpec[]
  /** Phase-boundary checkpoints (F5). Empty = no gates. */
  gates: OrchGateSpec[]
  /**
   * Run-wide shared conventions (F11, Bun PORTING.md pattern) — prepended to
   * EVERY worker prompt across all tasks and phases. Null = none.
   */
  contextPrompt: string | null
  /** Mechanical ground-truth check before commit (F12). Null = commit unverified. */
  verify: OrchVerifySpec | null
  /**
   * Environment init (ratified amendment A) — run ONCE per pool worktree
   * right after provisioning (e.g. ["bun", "install"]). Amortized across all
   * tasks that borrow the slot. Null = none.
   */
  init: { command: string[]; timeoutMs: number } | null
}

/**
 * Verify step (F12): the engine runs `command` in the task's worktree after
 * the final phase. Exit 0 -> commit. Non-zero -> re-run the fix phase with
 * the verify output as {{PRIOR}}, up to `retries` times, then task_failed.
 * The engine reads the exit code — a worker never self-certifies.
 */
export interface OrchVerifySpec {
  command: string[]
  timeoutMs: number
  retries: number
}

export const DEFAULT_VERIFY_TIMEOUT_MS = 300_000
export const DEFAULT_VERIFY_RETRIES = 2

export interface OrchTaskSpec {
  id: string
  title: string
  prompt: string
  /**
   * Declared file/dir ownership relative to repoRoot (F6). Overlap between
   * tasks is flagged (soft) at run creation — worktree isolation makes
   * overlap merge pain, not corruption.
   */
  scopePaths?: string[]
}

export interface OrchTaskSnapshot {
  taskId: string
  title: string
  state: OrchTaskState
  /** Current owning worker id; null when queued/terminal (single-owner invariant). */
  ownerWorkerId: string | null
  worktreePath: string | null
  branch: string | null
  /** Worktree-branch HEAD at claim time — the {{DIFF}} anchor (F13). */
  baseSha: string | null
  /** Index into config.phases of the current/last phase. -1 before first phase. */
  phaseIndex: number
  attempts: number
  error: string | null
  commitSha: string | null
  updatedAt: number
}

/**
 * One slot of the worktree pool (F13). Provisioned at createRun on branch
 * orch/<runId>/wt-<index>. `heldByTaskId` stays set across handed_back /
 * requeue so the task's uncommitted progress is never trampled (F2); it
 * clears only on committed/failed.
 */
export interface OrchWorktreeSlot {
  index: number
  path: string
  branch: string
  heldByTaskId: string | null
  /** True once the init command (if any) succeeded. */
  initialized: boolean
}

export interface OrchRunSnapshot {
  runId: string
  status: OrchRunStatus
  config: OrchRunConfig
  tasks: OrchTaskSnapshot[]
  /** Worktree pool state (F13), folded from provision/claim/terminal events. */
  worktrees: OrchWorktreeSlot[]
  createdAt: number
  updatedAt: number
}

export const DEFAULT_ORCH_PHASES: OrchPhaseSpec[] = [
  {
    name: "implement",
    kind: "implement",
    parallel: 1,
    promptTemplate:
      "You are the implementer. Complete this task in the current directory. Commit nothing; leave changes in the working tree.\n\nTask:\n{{TASK}}",
  },
  {
    name: "adversarial-review",
    kind: "review",
    parallel: 2,
    promptTemplate:
      "You are an adversarial reviewer. You see ONLY this diff. Find real bugs — logic errors, edge cases, broken invariants. Report each as file:line + problem + suggested fix. If none, reply NO_FINDINGS.\n\nDiff:\n{{DIFF}}",
  },
  {
    name: "fix",
    kind: "fix",
    parallel: 1,
    promptTemplate:
      "You are the fixer. Apply the accepted review feedback to the working tree. Reject feedback that is wrong, with one-line reasons.\n\nTask:\n{{TASK}}\n\nReview feedback:\n{{PRIOR}}",
  },
]

export const DEFAULT_MAX_PARALLEL_TASKS = 4
export const DEFAULT_WORKTREE_POOL_SIZE = 4
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_INIT_TIMEOUT_MS = 300_000
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/orchestration-types.ts
git commit -m "feat(orchestration): shared run/task/phase types"
```

---

### Task 2: Orchestration events + EventStore fold

**Files:**
- Modify: `src/server/events.ts` (add `OrchestrationEvent` union member + `StoreState.orchRunsById`)
- Modify: `src/server/event-store.ts` (new `orch.jsonl` log, sourceIndex 8, apply + append + queries)
- Test: `src/server/event-store-orchestration.test.ts`

- [ ] **Step 1: Add event types to `src/server/events.ts`**

Add imports at top (extend the existing `../shared/types` style import block):

```ts
import type {
  OrchGateDecision,
  OrchGateKind,
  OrchRunConfig,
  OrchRunStatus,
  OrchTaskSpec,
  OrchTaskState,
  OrchWorktreeSlot,
} from "../shared/orchestration-types"
```

Add after `ToolRequestEvent`:

```ts
export type OrchestrationEvent =
  | {
      v: 3
      type: "orch_run_created"
      timestamp: number
      runId: string
      config: OrchRunConfig
      tasks: OrchTaskSpec[]
    }
  | {
      v: 3
      type: "orch_worktree_provisioned"
      timestamp: number
      runId: string
      index: number
      path: string
      branch: string
    }
  | {
      v: 3
      type: "orch_worktree_init_started"
      timestamp: number
      runId: string
      index: number
    }
  | {
      v: 3
      type: "orch_worktree_init_completed"
      timestamp: number
      runId: string
      index: number
      ok: boolean
      outputExcerpt: string
    }
  | {
      v: 3
      type: "orch_task_claimed"
      timestamp: number
      runId: string
      taskId: string
      workerId: string
      /** Worktree-branch HEAD at claim — the {{DIFF}} anchor for this task (F13). */
      baseSha: string
      worktreePath: string
      branch: string
    }
  | {
      v: 3
      type: "orch_phase_started"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      phaseName: string
      workerIds: string[]
    }
  | {
      v: 3
      type: "orch_phase_completed"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      /** Joined worker output, capped at 64k chars — the {{PRIOR}} context for the next phase, persisted so a gated/recovered task can resume (F2). */
      output: string
      outputChars: number
      /** Per-worker link to the subagent run that executed it (F10) — the panel drill-in reuses the existing subagent transcript viewer. Null for fake/unlinked workers. */
      workers: Array<{ workerId: string; subagentRunId: string | null }>
    }
  | {
      v: 3
      type: "orch_gate_opened"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      phaseName: string
      gateKind: OrchGateKind
    }
  | {
      v: 3
      type: "orch_gate_resolved"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      decision: OrchGateDecision
    }
  | {
      v: 3
      type: "orch_scope_overlap_flagged"
      timestamp: number
      runId: string
      taskIds: string[]
      paths: string[]
    }
  | {
      v: 3
      type: "orch_config_warning"
      timestamp: number
      runId: string
      message: string
    }
  | {
      v: 3
      type: "orch_verify_started"
      timestamp: number
      runId: string
      taskId: string
      attempt: number
    }
  | {
      v: 3
      type: "orch_verify_completed"
      timestamp: number
      runId: string
      taskId: string
      attempt: number
      passed: boolean
      outputExcerpt: string
    }
  | {
      v: 3
      type: "orch_task_committed"
      timestamp: number
      runId: string
      taskId: string
      commitSha: string | null
    }
  | {
      v: 3
      type: "orch_task_failed"
      timestamp: number
      runId: string
      taskId: string
      error: string
    }
  | {
      v: 3
      type: "orch_task_requeued"
      timestamp: number
      runId: string
      taskId: string
      reason: "handed_back" | "restart_recovery"
      detail: string | null
    }
  | {
      v: 3
      type: "orch_run_completed"
      timestamp: number
      runId: string
    }
  | {
      v: 3
      type: "orch_run_cancelled"
      timestamp: number
      runId: string
    }
```

Extend the `StoreEvent` union:

```ts
export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | AutoContinueEvent | SubagentRunEvent | ToolRequestEvent | OrchestrationEvent
```

Add the in-memory record types + `StoreState` field (records are mutable fold targets, snapshots are the read API):

```ts
export interface OrchTaskRecord {
  taskId: string
  title: string
  prompt: string
  scopePaths: string[]
  state: OrchTaskState
  ownerWorkerId: string | null
  worktreePath: string | null
  branch: string | null
  /** Worktree-branch HEAD at claim — {{DIFF}} anchor (F13). */
  baseSha: string | null
  phaseIndex: number
  attempts: number
  error: string | null
  commitSha: string | null
  /** Last completed phase's joined output — resume context after gate/restart. */
  lastPhaseOutput: string | null
  updatedAt: number
}

export interface OrchRunRecord {
  runId: string
  status: OrchRunStatus
  config: OrchRunConfig
  tasksById: Map<string, OrchTaskRecord>
  taskOrder: string[]
  /** Worktree pool (F13) — provisioned slots, hold state folded from events. */
  worktrees: OrchWorktreeSlot[]
  /**
   * Full ordered event timeline for this run (F8) — the rich drill-in source
   * (phase timings, gate history, requeue reasons, outputs). Rebuilt on
   * restart by replay. Memory bounded by the 64k phase-output cap.
   */
  eventLog: OrchestrationEvent[]
  createdAt: number
  updatedAt: number
}
```

In `StoreState` add:

```ts
  orchRunsById: Map<string, OrchRunRecord>
```

In `createEmptyState()` add:

```ts
    orchRunsById: new Map(),
```

- [ ] **Step 2: Write the failing test**

```ts
// src/server/event-store-orchestration.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import type { OrchRunConfig } from "../shared/orchestration-types"
import { DEFAULT_ORCH_PHASES } from "../shared/orchestration-types"

function makeConfig(): OrchRunConfig {
  return {
    title: "test run",
    repoRoot: "/tmp/fake-repo",
    baseBranch: "main",
    maxParallelTasks: 2,
    worktreePoolSize: 2,
    maxAttempts: 3,
    phases: DEFAULT_ORCH_PHASES,
    gates: [],
    contextPrompt: null,
    verify: null,
    init: null,
  }
}

async function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-store-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir }
}

describe("EventStore orchestration events", () => {
  test("orch_run_created folds tasks as queued", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(),
      tasks: [
        { id: "t1", title: "task one", prompt: "do one" },
        { id: "t2", title: "task two", prompt: "do two" },
      ],
    })
    const run = store.getOrchRun("r1")
    expect(run).not.toBeNull()
    expect(run!.status).toBe("running")
    expect(run!.tasks.map((t) => t.state)).toEqual(["queued", "queued"])
    expect(run!.tasks.map((t) => t.ownerWorkerId)).toEqual([null, null])
  })

  test("claim -> phase -> committed folds state, owner, attempts", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    let task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("claimed")
    expect(task.ownerWorkerId).toBe("w-1")
    expect(task.attempts).toBe(1)

    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-1"],
    })
    task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("running")
    expect(task.phaseIndex).toBe(0)

    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_committed", timestamp: 4, runId: "r1", taskId: "t1",
      commitSha: "abc123",
    })
    task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(task.ownerWorkerId).toBeNull()
    expect(task.commitSha).toBe("abc123")
  })

  test("orch_task_requeued clears owner, keeps worktree + attempts", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_requeued", timestamp: 3, runId: "r1", taskId: "t1",
      reason: "restart_recovery", detail: null,
    })
    const task = store.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("queued")
    expect(task.ownerWorkerId).toBeNull()
    expect(task.worktreePath).toBe("/wt/t1")
    expect(task.attempts).toBe(1)
  })

  test("events survive restart via log replay (AG2)", async () => {
    const { store, dir } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.flush()

    const reopened = new EventStore(dir)
    await reopened.initialize()
    const run = reopened.getOrchRun("r1")
    expect(run).not.toBeNull()
    expect(run!.tasks[0]!.state).toBe("claimed")
    expect(run!.tasks[0]!.ownerWorkerId).toBe("w-1")
  })

  test("getOrchRunEvents retains full timeline and rebuilds on replay (F8)", async () => {
    const { store, dir } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(), tasks: [{ id: "t1", title: "t", prompt: "p" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_requeued", timestamp: 3, runId: "r1", taskId: "t1",
      reason: "handed_back", detail: "hit unknown",
    })
    expect(store.getOrchRunEvents("r1").map((e) => e.type)).toEqual([
      "orch_run_created", "orch_task_claimed", "orch_task_requeued",
    ])
    await store.flush()
    const reopened = new EventStore(dir)
    await reopened.initialize()
    expect(reopened.getOrchRunEvents("r1").map((e) => e.type)).toEqual([
      "orch_run_created", "orch_task_claimed", "orch_task_requeued",
    ])
  })

  test("nonTerminalOrchTasks yields claimed/running, skips terminal", async () => {
    const { store } = await makeStore()
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig(),
      tasks: [
        { id: "t1", title: "a", prompt: "a" },
        { id: "t2", title: "b", prompt: "b" },
        { id: "t3", title: "c", prompt: "c" },
      ],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-1", worktreePath: "/wt/t1", branch: "b1", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 3, runId: "r1", taskId: "t2",
      workerId: "w-2", worktreePath: "/wt/t2", branch: "b2", baseSha: "base1",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_committed", timestamp: 4, runId: "r1", taskId: "t2",
      commitSha: null,
    })
    const pending = [...store.nonTerminalOrchTasks()]
    expect(pending.map((p) => p.taskId)).toEqual(["t1"])
    expect(pending[0]!.runId).toBe("r1")
  })
})
```

Note: if `EventStore` has no public `flush()`, check for one (`grep -n "flush" src/server/event-store.ts`); if absent, add `async flush() { await this.writeChain }` — the writeChain field exists at line 232.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test --conditions production src/server/event-store-orchestration.test.ts`
Expected: FAIL — `appendOrchestrationEvent is not a function`

- [ ] **Step 4: Implement in `src/server/event-store.ts`**

Import the new types (extend the existing `./events` import):

```ts
import type { OrchestrationEvent, OrchRunRecord, OrchTaskRecord } from "./events"
import type { OrchRunSnapshot, OrchTaskSnapshot } from "../shared/orchestration-types"
```

Constructor (after `toolRequestsLogPath`, line ~279):

```ts
    this.orchLogPath = path.join(this.dataDir, "orch.jsonl")
```

Field declaration (after `toolRequestsLogPath` field, line ~245):

```ts
  private readonly orchLogPath: string
```

`initialize()` (after the `toolRequestsLogPath` ensureFile, line ~297):

```ts
    await this.ensureFile(this.orchLogPath)
```

`replayLogs()` source list (after sourceIndex 7, line ~528):

```ts
      ...await this.loadReplayEvents(this.orchLogPath, 8),
```

In the `applyEvent` switch (the `switch (e.type)` at line ~598) add cases delegating to one fold function:

```ts
      case "orch_run_created":
      case "orch_worktree_provisioned":
      case "orch_worktree_init_started":
      case "orch_worktree_init_completed":
      case "orch_task_claimed":
      case "orch_phase_started":
      case "orch_phase_completed":
      case "orch_gate_opened":
      case "orch_gate_resolved":
      case "orch_scope_overlap_flagged":
      case "orch_config_warning":
      case "orch_verify_started":
      case "orch_verify_completed":
      case "orch_task_committed":
      case "orch_task_failed":
      case "orch_task_requeued":
      case "orch_run_completed":
      case "orch_run_cancelled":
        this.applyOrchestrationEvent(e)
        break
```

Add the fold + API methods (near `appendSubagentEvent`, line ~1702 — same apply-sync-then-enqueue pattern, which is what makes a claim atomic within one event-loop turn):

```ts
  private applyOrchestrationEvent(event: OrchestrationEvent) {
    if (event.type === "orch_run_created") {
      const tasksById = new Map<string, OrchTaskRecord>()
      for (const spec of event.tasks) {
        tasksById.set(spec.id, {
          taskId: spec.id,
          title: spec.title,
          prompt: spec.prompt,
          scopePaths: spec.scopePaths ?? [],
          state: "queued",
          ownerWorkerId: null,
          worktreePath: null,
          branch: null,
          baseSha: null,
          phaseIndex: -1,
          attempts: 0,
          error: null,
          commitSha: null,
          lastPhaseOutput: null,
          updatedAt: event.timestamp,
        })
      }
      this.state.orchRunsById.set(event.runId, {
        runId: event.runId,
        status: "running",
        config: event.config,
        tasksById,
        taskOrder: event.tasks.map((t) => t.id),
        worktrees: [],
        eventLog: [event],
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      })
      return
    }
    const run = this.state.orchRunsById.get(event.runId)
    if (!run) return
    run.eventLog.push(event)
    run.updatedAt = event.timestamp
    if (event.type === "orch_run_completed") { run.status = "completed"; return }
    if (event.type === "orch_run_cancelled") { run.status = "cancelled"; return }
    if (event.type === "orch_scope_overlap_flagged") return // observability-only, no state fold
    if (event.type === "orch_config_warning") return // observability-only, no state fold
    // Worktree pool fold (F13)
    if (event.type === "orch_worktree_provisioned") {
      run.worktrees.push({
        index: event.index, path: event.path, branch: event.branch,
        heldByTaskId: null, initialized: false,
      })
      return
    }
    if (event.type === "orch_worktree_init_started") return // timeline-only
    if (event.type === "orch_worktree_init_completed") {
      const slot = run.worktrees.find((w) => w.index === event.index)
      if (slot) slot.initialized = event.ok
      return
    }
    const task = run.tasksById.get(event.taskId)
    if (!task) return
    task.updatedAt = event.timestamp
    const slotOf = (t: OrchTaskRecord) => run.worktrees.find((w) => w.path === t.worktreePath)
    switch (event.type) {
      case "orch_task_claimed":
        task.state = "claimed"
        task.ownerWorkerId = event.workerId
        task.worktreePath = event.worktreePath
        task.branch = event.branch
        task.baseSha = event.baseSha
        task.attempts += 1
        {
          const slot = slotOf(task)
          if (slot) slot.heldByTaskId = task.taskId
        }
        break
      case "orch_phase_started":
        task.state = "running"
        task.phaseIndex = event.phaseIndex
        break
      case "orch_phase_completed":
        task.lastPhaseOutput = event.output
        break
      case "orch_gate_opened":
        task.state = "gated"
        break
      case "orch_gate_resolved":
        if (event.decision === "approve") task.state = "running"
        // reject: state stays gated; the engine appends orch_task_failed next
        break
      case "orch_verify_started":
      case "orch_verify_completed":
        break // timeline-only (eventLog); task stays "running"
      case "orch_task_committed":
        task.state = "committed"
        task.ownerWorkerId = null
        task.commitSha = event.commitSha
        {
          const slot = slotOf(task)
          if (slot?.heldByTaskId === task.taskId) slot.heldByTaskId = null
        }
        break
      case "orch_task_failed":
        task.state = "failed"
        task.ownerWorkerId = null
        task.error = event.error
        {
          const slot = slotOf(task)
          if (slot?.heldByTaskId === task.taskId) slot.heldByTaskId = null
        }
        break
      case "orch_task_requeued":
        // Slot hold deliberately KEPT (F13/F2): the task's uncommitted progress
        // lives in its worktree — re-claim resumes the SAME slot.
        task.state = "queued"
        task.ownerWorkerId = null
        break
    }
  }

  /**
   * Apply synchronously, then enqueue the disk append — the sync apply is what
   * makes an orchestration claim atomic within one event-loop turn (same
   * pattern as appendSubagentEvent).
   */
  appendOrchestrationEvent(event: OrchestrationEvent): Promise<void> {
    this.applyEvent(event)
    this.enqueueDiskAppend(this.orchLogPath, `${JSON.stringify(event)}\n`)
    return Promise.resolve()
  }

  getOrchRun(runId: string): OrchRunSnapshot | null {
    const run = this.state.orchRunsById.get(runId)
    if (!run) return null
    return this.toOrchRunSnapshot(run)
  }

  getOrchRuns(): OrchRunSnapshot[] {
    return [...this.state.orchRunsById.values()].map((r) => this.toOrchRunSnapshot(r))
  }

  private toOrchRunSnapshot(run: OrchRunRecord): OrchRunSnapshot {
    const tasks: OrchTaskSnapshot[] = run.taskOrder.flatMap((taskId) => {
      const t = run.tasksById.get(taskId)
      if (!t) return []
      return [{
        taskId: t.taskId,
        title: t.title,
        state: t.state,
        ownerWorkerId: t.ownerWorkerId,
        worktreePath: t.worktreePath,
        branch: t.branch,
        baseSha: t.baseSha,
        phaseIndex: t.phaseIndex,
        attempts: t.attempts,
        error: t.error,
        commitSha: t.commitSha,
        updatedAt: t.updatedAt,
      }]
    })
    return {
      runId: run.runId,
      status: run.status,
      config: run.config,
      tasks,
      worktrees: run.worktrees.map((w) => ({ ...w })),
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }
  }

  /** Tasks a restart must RE-QUEUE. `gated` is deliberately excluded — a gated task is re-armed in place (gate re-notified), never requeued. */
  *nonTerminalOrchTasks(): Iterable<{ runId: string; taskId: string; state: "claimed" | "running" }> {
    for (const run of this.state.orchRunsById.values()) {
      if (run.status !== "running") continue
      for (const task of run.tasksById.values()) {
        if (task.state === "claimed" || task.state === "running") {
          yield { runId: run.runId, taskId: task.taskId, state: task.state }
        }
      }
    }
  }

  /** Tasks paused at a hard gate — re-armed (not requeued) by recoverOnStartup. */
  *gatedOrchTasks(): Iterable<{ runId: string; taskId: string; phaseIndex: number }> {
    for (const run of this.state.orchRunsById.values()) {
      if (run.status !== "running") continue
      for (const task of run.tasksById.values()) {
        if (task.state === "gated") {
          yield { runId: run.runId, taskId: task.taskId, phaseIndex: task.phaseIndex }
        }
      }
    }
  }

  /** Task spec lookup for the engine (records keep prompt/scope; snapshots do not). */
  getOrchTaskSpec(runId: string, taskId: string): { prompt: string; scopePaths: string[] } | null {
    const task = this.state.orchRunsById.get(runId)?.tasksById.get(taskId)
    if (!task) return null
    return { prompt: task.prompt, scopePaths: task.scopePaths }
  }

  /** Last completed phase's output — {{PRIOR}} context when resuming a gated/recovered task. */
  getOrchLastPhaseOutput(runId: string, taskId: string): string | null {
    return this.state.orchRunsById.get(runId)?.tasksById.get(taskId)?.lastPhaseOutput ?? null
  }

  /** Full ordered event timeline for one run — the rich drill-in source (F8). */
  getOrchRunEvents(runId: string): OrchestrationEvent[] {
    return [...(this.state.orchRunsById.get(runId)?.eventLog ?? [])]
  }
```

If `flush()` doesn't exist, add:

```ts
  async flush(): Promise<void> {
    await this.writeChain
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/server/event-store-orchestration.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Lint + commit**

```bash
bun run lint
git add src/server/events.ts src/server/event-store.ts src/server/event-store-orchestration.test.ts
git commit -m "feat(orchestration): durable orch event log with sync-apply claim atomicity"
```

---

### Task 3: Git port adapter (commitAll + diffAgainstBase)

**Files:**
- Create: `src/server/orchestration-git.adapter.ts`
- Test: `src/server/orchestration-git.adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/orchestration-git.adapter.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import { commitAll, diffAgainstBase } from "./orchestration-git.adapter"
import { addWorktree } from "./worktree-store.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-git-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration-git.adapter", () => {
  test("commitAll commits working-tree changes and returns sha", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "a.txt"), "content\n")
    const result = await commitAll(repo, "orch: task t1")
    expect(result.kind).toBe("committed")
    if (result.kind === "committed") {
      expect(result.sha).toMatch(/^[0-9a-f]{7,40}$/)
    }
  }, 30_000)

  test("commitAll on clean tree returns noChanges", async () => {
    const repo = await makeRepo()
    const result = await commitAll(repo, "orch: nothing")
    expect(result.kind).toBe("noChanges")
  }, 30_000)

  test("diffAgainstBase returns unified diff of worktree branch vs base", async () => {
    const repo = await makeRepo()
    const wtPath = path.join(repo, ".worktrees", "t1")
    mkdirSync(path.dirname(wtPath), { recursive: true })
    await addWorktree(repo, { kind: "new-branch", branch: "orch/r1/t1", path: wtPath, base: "main" })
    writeFileSync(path.join(wtPath, "feature.txt"), "new feature\n")
    await runGit(["add", "feature.txt"], wtPath)
    const diff = await diffAgainstBase(wtPath, "main")
    expect(diff).toContain("feature.txt")
    expect(diff).toContain("+new feature")
  }, 30_000)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/orchestration-git.adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the adapter**

```ts
// src/server/orchestration-git.adapter.ts
import { runGit, formatGitFailure } from "./diff-store"

export type CommitAllResult =
  | { kind: "committed"; sha: string }
  | { kind: "noChanges" }

/**
 * Stage everything in the worktree and commit. Leaf adapter — wraps git only,
 * no domain logic (ref-side-effect-adapter).
 */
export async function commitAll(worktreePath: string, message: string): Promise<CommitAllResult> {
  const status = await runGit(["status", "--porcelain", "-z"], worktreePath)
  if (status.exitCode !== 0) throw new Error(formatGitFailure(status) || "git status failed")
  if (status.stdout.length === 0) return { kind: "noChanges" }
  const add = await runGit(["add", "-A"], worktreePath)
  if (add.exitCode !== 0) throw new Error(formatGitFailure(add) || "git add failed")
  const commit = await runGit(["commit", "-m", message], worktreePath)
  if (commit.exitCode !== 0) throw new Error(formatGitFailure(commit) || "git commit failed")
  const rev = await runGit(["rev-parse", "HEAD"], worktreePath)
  if (rev.exitCode !== 0) throw new Error(formatGitFailure(rev) || "git rev-parse failed")
  return { kind: "committed", sha: rev.stdout.trim() }
}

/**
 * Unified diff of the worktree (staged + unstaged + committed on its branch)
 * against the merge base with `baseBranch`. Used as the {{DIFF}} context for
 * adversarial review phases.
 */
export async function diffAgainstBase(worktreePath: string, baseBranch: string): Promise<string> {
  const staged = await runGit(["add", "-A", "--intent-to-add"], worktreePath)
  if (staged.exitCode !== 0) throw new Error(formatGitFailure(staged) || "git add -N failed")
  const diff = await runGit(["diff", baseBranch], worktreePath)
  if (diff.exitCode !== 0) throw new Error(formatGitFailure(diff) || "git diff failed")
  return diff.stdout
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/server/orchestration-git.adapter.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/orchestration-git.adapter.ts src/server/orchestration-git.adapter.test.ts
git commit -m "feat(orchestration): git adapter for atomic commit + review diff"
```

---

### Task 4: OrchestrationQueue — claim scheduling with own permit pool

**Files:**
- Create: `src/server/orchestration-queue.ts`
- Test: `src/server/orchestration-queue.test.ts`

The engine is pure logic — every side effect is an injected port. This task builds run creation + the scheduler (claim → worktree → single phase execution happy path). Tasks 5–8 extend it.

- [ ] **Step 1: Write the port types + engine skeleton test**

```ts
// src/server/orchestration-queue.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import {
  OrchestrationQueue,
  type OrchWorktreeOps,
  type StartWorker,
} from "./orchestration-queue"
import type { OrchPhaseSpec, OrchRunConfig, OrchTaskSpec } from "../shared/orchestration-types"

export function fakeWorktreeOps(): OrchWorktreeOps & { added: string[]; removed: string[]; resets: string[] } {
  const added: string[] = []
  const removed: string[] = []
  const resets: string[] = []
  return {
    added,
    removed,
    resets,
    async ensureWorktree(repoRoot, branch, wtPath, _base) {
      added.push(wtPath)
      return { path: wtPath, branch, headSha: `head-${branch}` }
    },
    async removeWorktree(_repoRoot, wtPath) {
      removed.push(wtPath)
    },
    async commitAll(_wtPath, _message) {
      return { kind: "committed", sha: "fakesha" }
    },
    async diffAgainstBase(_wtPath, _base) {
      return "diff --git a/x b/x\n+fake"
    },
    async resetHard(wtPath) {
      resets.push(wtPath)
    },
  }
}

function phases(overrides?: Partial<OrchPhaseSpec>[]): OrchPhaseSpec[] {
  const base: OrchPhaseSpec[] = [
    { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
  ]
  if (!overrides) return base
  return overrides.map((o, i) => ({ ...base[0]!, name: `p${i}`, ...o }))
}

function makeConfig(partial?: Partial<OrchRunConfig>): OrchRunConfig {
  return {
    title: "run",
    repoRoot: "/repo",
    baseBranch: "main",
    maxParallelTasks: 2,
    worktreePoolSize: 2,
    maxAttempts: 3,
    phases: phases(),
    gates: [],
    contextPrompt: null,
    verify: null,
    init: null,
    ...partial,
  }
}

async function makeStore() {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-q-"))
  const store = new EventStore(dir)
  await store.initialize()
  return { store, dir }
}

function tasks(n: number): OrchTaskSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, title: `task ${i + 1}`, prompt: `do ${i + 1}` }))
}

describe("OrchestrationQueue scheduling", () => {
  test("runs all tasks to committed with fake workers", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "done" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(3))
    await q.waitForRun(runId)
    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    expect(run.tasks.every((t) => t.state === "committed")).toBe(true)
    expect(run.tasks.every((t) => t.ownerWorkerId === null)).toBe(true)
  })

  test("maxParallelTasks bounds concurrent claims (own permit pool, F3)", async () => {
    const { store } = await makeStore()
    let inFlight = 0
    let peak = 0
    const gate: Array<() => void> = []
    const startWorker: StartWorker = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => gate.push(resolve))
      inFlight -= 1
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 2 }), tasks(5))
    // let the scheduler claim up to the cap
    await new Promise((r) => setTimeout(r, 20))
    expect(peak).toBe(2)
    // release all workers as they arrive until done
    const release = setInterval(() => { gate.splice(0).forEach((g) => g()) }, 5)
    await q.waitForRun(runId)
    clearInterval(release)
    expect(peak).toBe(2)
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("single owner per task — no double assignment (CKR-2)", async () => {
    const { store } = await makeStore()
    const ownersSeen = new Map<string, string[]>()
    const startWorker: StartWorker = async (args) => {
      const list = ownersSeen.get(args.taskId) ?? []
      list.push(args.workerId)
      ownersSeen.set(args.taskId, list)
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 4 }), tasks(8))
    await q.waitForRun(runId)
    for (const [, owners] of ownersSeen) {
      // one phase, parallel 1 → exactly one worker ever touched each task
      expect(owners.length).toBe(1)
    }
  })

  test("worktree pool provisioned up front with deterministic slot branches (F13)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig({ worktreePoolSize: 2 }), tasks(1))
    await q.waitForRun(runId)
    // pool provisioned in full at createRun, regardless of task count
    expect(wt.added).toHaveLength(2)
    const run = store.getOrchRun(runId)!
    expect(run.worktrees.map((w) => w.branch)).toEqual([`orch/${runId}/wt-0`, `orch/${runId}/wt-1`])
    expect(run.worktrees.every((w) => w.initialized)).toBe(true)
    // the task borrowed slot 0 and recorded its diff anchor
    const task = run.tasks[0]!
    expect(task.branch).toBe(`orch/${runId}/wt-0`)
    expect(task.worktreePath).toBe(run.worktrees[0]!.path)
    expect(task.baseSha).toBe(`head-orch/${runId}/wt-0`)
  })

  test("two tasks NEVER share a worktree slot concurrently (F13 thread safety)", async () => {
    const { store } = await makeStore()
    const inFlightByCwd = new Map<string, number>()
    let violations = 0
    const gate: Array<() => void> = []
    const startWorker: StartWorker = async (args) => {
      const n = (inFlightByCwd.get(args.cwd) ?? 0) + 1
      inFlightByCwd.set(args.cwd, n)
      if (n > 1) violations += 1
      await new Promise<void>((resolve) => gate.push(resolve))
      inFlightByCwd.set(args.cwd, (inFlightByCwd.get(args.cwd) ?? 1) - 1)
      return { kind: "completed", text: "ok" }
    }
    // more workers than slots: concurrency must clamp to the pool size
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 4, worktreePoolSize: 2 }), tasks(5))
    const release = setInterval(() => { gate.splice(0).forEach((g) => g()) }, 5)
    await q.waitForRun(runId)
    clearInterval(release)
    expect(violations).toBe(0)
    expect(store.getOrchRun(runId)!.tasks.every((t) => t.state === "committed")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the engine**

```ts
// src/server/orchestration-queue.ts
import crypto from "node:crypto"
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import type {
  OrchGateDecision,
  OrchGateKind,
  OrchPhaseSpec,
  OrchRunConfig,
  OrchRunSnapshot,
  OrchTaskSpec,
} from "../shared/orchestration-types"
import type { OrchestrationEvent } from "./events"

/** Subset of EventStore the engine needs (keeps the engine fake-able). */
export interface OrchEventStore {
  appendOrchestrationEvent(event: OrchestrationEvent): Promise<void>
  getOrchRun(runId: string): OrchRunSnapshot | null
  getOrchRuns(): OrchRunSnapshot[]
  /** Task spec (prompt + scopePaths) — kept on records, stripped from snapshots. */
  getOrchTaskSpec(runId: string, taskId: string): { prompt: string; scopePaths: string[] } | null
  getOrchLastPhaseOutput(runId: string, taskId: string): string | null
  nonTerminalOrchTasks(): Iterable<{ runId: string; taskId: string; state: "claimed" | "running" }>
  gatedOrchTasks(): Iterable<{ runId: string; taskId: string; phaseIndex: number }>
}

/** Notification that a task reached a gate — Plan B wires this to the durable approval UI. */
export interface OrchGateOpenedNotice {
  runId: string
  taskId: string
  phaseIndex: number
  phaseName: string
  gateKind: OrchGateKind
}

/** Cap on persisted phase output ({{PRIOR}} resume context). */
const MAX_PHASE_OUTPUT_CHARS = 64_000

export interface OrchWorktreeOps {
  /**
   * Create the worktree if missing; reuse if branch/path already exist
   * (pool provisioning + restart recovery). Returns the branch HEAD sha —
   * the engine tracks per-slot HEADs so claims can record a synchronous
   * `baseSha` (the {{DIFF}} anchor) without an async git call.
   */
  ensureWorktree(repoRoot: string, branch: string, wtPath: string, base: string): Promise<{ path: string; branch: string; headSha: string }>
  removeWorktree(repoRoot: string, wtPath: string): Promise<void>
  commitAll(wtPath: string, message: string): Promise<{ kind: "committed"; sha: string } | { kind: "noChanges" }>
  /** Unified diff of the worktree (incl. uncommitted changes) against `baseRef` — a sha or branch name. */
  diffAgainstBase(wtPath: string, baseRef: string): Promise<string>
  /**
   * Discard ALL uncommitted changes (git reset --hard + clean). Called ONLY
   * when a task fails terminally, so the next pool borrower gets a clean
   * tree (F13). Never called on hand-back/requeue — that progress is kept (F2).
   */
  resetHard(wtPath: string): Promise<void>
}

/**
 * `subagentRunId` (F10): the subagent run that executed this worker — links
 * the orchestration panel to the existing subagent transcript viewer (full
 * per-worker transcript + usage, zero duplicate storage). Plan B's real
 * StartWorker fills it; fakes and Plan A leave it undefined.
 * Hand-back (F9, Plan B): real workers signal via the
 * `mcp__kanna__orch_hand_back({reason})` MCP tool registered on worker
 * spawns; the provider run maps it to `{kind:"handed_back"}`.
 */
export type WorkerResult =
  | { kind: "completed"; text: string; subagentRunId?: string }
  | { kind: "failed"; error: string; subagentRunId?: string }
  | { kind: "handed_back"; reason: string; subagentRunId?: string }

export interface WorkerSpawnArgs {
  runId: string
  taskId: string
  workerId: string
  phase: OrchPhaseSpec
  phaseIndex: number
  cwd: string
  prompt: string
  abortSignal: AbortSignal
}

export type StartWorker = (args: WorkerSpawnArgs) => Promise<WorkerResult>

export interface OrchestrationQueueDeps {
  store: OrchEventStore
  worktrees: OrchWorktreeOps
  startWorker: StartWorker
  /**
   * F12: run `command` in `wtPath` with a timeout; return exit code + combined
   * stdout+stderr. Optional — if absent, verify is a no-op even when
   * `config.verify` is set (Plan A tests use fakes; Plan B wires the real adapter).
   */
  runVerify?: (wtPath: string, command: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>
  /**
   * Amendment A: env init — same shape as runVerify; run ONCE per pool
   * worktree at provisioning when `config.init` is set. Optional; absent =
   * init skipped (slots count as initialized).
   */
  runInit?: (wtPath: string, command: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>
  /** Fired when a task reaches a gate (soft or hard). Optional for tests. */
  onGateOpened?: (notice: OrchGateOpenedNotice) => void
  now?: () => number
  /** Subdir under repoRoot for worktrees. Default ".kanna-worktrees". */
  worktreeDir?: string
}

interface TaskRuntime {
  abortController: AbortController
}

interface RunRuntime {
  cancelled: boolean
  permits: number
  taskRuntimes: Map<string, TaskRuntime>
  /** Pending hard-gate waiters keyed by taskId; resolved by resolveGate/cancelRun. */
  gateResolvers: Map<string, (decision: OrchGateDecision) => void>
  /**
   * Per-slot current HEAD sha (path → sha), seeded at provisioning and
   * updated after each task commit — lets the synchronous claim record
   * `baseSha` without an async git call (F13 atomicity).
   */
  slotHeads: Map<string, string>
  /** True once pool provisioning finished — scheduler no-ops before that. */
  poolReady: boolean
  done: { promise: Promise<void>; resolve: () => void }
  scheduling: boolean
}

/** Resume context for a task recovered while paused at a hard gate. */
interface GatedResume {
  fromPhase: number
  prior: string
  pendingGate: { phaseIndex: number; phaseName: string; kind: OrchGateKind }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => { resolve = res })
  return { promise, resolve }
}

function normalizeScopePath(p: string): string {
  return p.replace(/^\.\//u, "").replace(/\/+$/u, "")
}

/**
 * Pairwise scope-overlap detection (F6): two paths overlap when equal or one
 * is a directory prefix of the other. Returns null when disjoint.
 */
export function detectScopeOverlap(tasks: OrchTaskSpec[]): { taskIds: string[]; paths: string[] } | null {
  const taskIds = new Set<string>()
  const paths = new Set<string>()
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      for (const rawA of tasks[i]!.scopePaths ?? []) {
        for (const rawB of tasks[j]!.scopePaths ?? []) {
          const a = normalizeScopePath(rawA)
          const b = normalizeScopePath(rawB)
          if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
            taskIds.add(tasks[i]!.id)
            taskIds.add(tasks[j]!.id)
            paths.add(a)
            paths.add(b)
          }
        }
      }
    }
  }
  if (taskIds.size === 0) return null
  return { taskIds: [...taskIds], paths: [...paths] }
}

export class OrchestrationQueue {
  private readonly runRuntimes = new Map<string, RunRuntime>()

  constructor(private readonly deps: OrchestrationQueueDeps) {}

  private now() { return this.deps.now?.() ?? Date.now() }
  private worktreeDir() { return this.deps.worktreeDir ?? ".kanna-worktrees" }

  async createRun(config: OrchRunConfig, tasks: OrchTaskSpec[]): Promise<string> {
    const runId = crypto.randomUUID()
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: this.now(), runId, config, tasks,
    })
    const overlap = detectScopeOverlap(tasks)
    if (overlap) {
      // Soft warn (F6): worktree isolation makes overlap merge pain, not corruption.
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_scope_overlap_flagged", timestamp: this.now(), runId,
        taskIds: overlap.taskIds, paths: overlap.paths,
      })
    }
    if (config.maxParallelTasks > config.worktreePoolSize) {
      // Soft warn: slots are the scarce resource — permits above pool size never run.
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_config_warning", timestamp: this.now(), runId,
        message: `maxParallelTasks (${config.maxParallelTasks}) exceeds worktreePoolSize (${config.worktreePoolSize}); effective parallelism is capped at ${config.worktreePoolSize}`,
      })
    }
    const rt = this.ensureRunRuntime(runId, config)
    await this.provisionPool(rt, runId, config)
    rt.poolReady = true
    this.schedule(runId)
    return runId
  }

  /**
   * F13: pre-create the whole worktree pool up front (user flow step 3) —
   * one worktree per slot on branch orch/<runId>/wt-<i>, then run the env
   * init command once per slot (amendment A). Init failure marks the slot
   * unusable (initialized=false) but never kills the run — the scheduler
   * skips unusable slots and fails queued tasks only when NO slot is usable.
   */
  private async provisionPool(rt: RunRuntime, runId: string, config: OrchRunConfig): Promise<void> {
    for (let i = 0; i < config.worktreePoolSize; i++) {
      if (rt.cancelled) return
      const branch = `orch/${runId}/wt-${i}`
      const wtPath = path.join(config.repoRoot, this.worktreeDir(), runId, `wt-${i}`)
      const wt = await this.deps.worktrees.ensureWorktree(config.repoRoot, branch, wtPath, config.baseBranch)
      rt.slotHeads.set(wt.path, wt.headSha)
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_worktree_provisioned", timestamp: this.now(), runId,
        index: i, path: wt.path, branch,
      })
      if (config.init && this.deps.runInit) {
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_worktree_init_started", timestamp: this.now(), runId, index: i,
        })
        const result = await this.deps.runInit(wt.path, config.init.command, config.init.timeoutMs)
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_worktree_init_completed", timestamp: this.now(), runId,
          index: i, ok: result.exitCode === 0, outputExcerpt: result.output.slice(0, 2_000),
        })
      } else {
        // No init configured — slot is usable immediately (fold only marks
        // initialized on the event, so emit ok:true for a uniform read model).
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_worktree_init_completed", timestamp: this.now(), runId,
          index: i, ok: true, outputExcerpt: "",
        })
      }
    }
  }

  /** True when resolveGate found and resolved a pending hard gate. */
  resolveGate(runId: string, taskId: string, decision: OrchGateDecision): boolean {
    const rt = this.runRuntimes.get(runId)
    const resolver = rt?.gateResolvers.get(taskId)
    if (!rt || !resolver) return false
    rt.gateResolvers.delete(taskId)
    resolver(decision)
    return true
  }

  /** Resolves when the run reaches a terminal status. Unknown run resolves immediately. */
  waitForRun(runId: string): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return Promise.resolve()
    return rt.done.promise
  }

  private ensureRunRuntime(runId: string, config: OrchRunConfig): RunRuntime {
    const existing = this.runRuntimes.get(runId)
    if (existing) return existing
    const rt: RunRuntime = {
      cancelled: false,
      permits: config.maxParallelTasks,
      taskRuntimes: new Map(),
      gateResolvers: new Map(),
      slotHeads: new Map(),
      poolReady: false,
      done: deferred(),
      scheduling: false,
    }
    this.runRuntimes.set(runId, rt)
    return rt
  }

  /**
   * Claim loop (F13). A claim = task + free worktree slot bound in ONE
   * synchronous event apply — single-process JS + sync-apply means no two
   * tasks can ever hold the same slot (thread safety without locks).
   * `takenThisTurn` guards against the stale-snapshot window inside the loop
   * (the local `run` copy does not see this turn's own claims).
   */
  private schedule(runId: string): void {
    const rt = this.runRuntimes.get(runId)
    if (!rt || rt.cancelled || rt.scheduling || !rt.poolReady) return
    rt.scheduling = true
    try {
      const run = this.deps.store.getOrchRun(runId)
      if (!run || run.status !== "running") { this.finishIfTerminal(runId); return }
      const usable = run.worktrees.filter((w) => w.initialized)
      if (usable.length === 0) {
        // Pool entirely unusable (all init failed) — no task can ever run.
        for (const task of run.tasks) {
          if (task.state !== "queued") continue
          void this.deps.store.appendOrchestrationEvent({
            v: 3, type: "orch_task_failed", timestamp: this.now(), runId,
            taskId: task.taskId, error: "worktree pool unusable: every slot failed env init",
          })
        }
        this.finishIfTerminal(runId)
        return
      }
      const takenThisTurn = new Set<string>()
      for (const task of run.tasks) {
        if (rt.permits <= 0) break
        if (task.state !== "queued") continue
        if (task.attempts >= run.config.maxAttempts) {
          void this.deps.store.appendOrchestrationEvent({
            v: 3, type: "orch_task_failed", timestamp: this.now(), runId,
            taskId: task.taskId, error: `max attempts (${run.config.maxAttempts}) exhausted`,
          })
          continue
        }
        // Slot pick: a requeued task is still bound to its slot (fold keeps the
        // hold across requeue — its uncommitted progress lives there, F2);
        // a fresh task borrows the first free initialized slot.
        const slot = task.worktreePath !== null
          ? run.worktrees.find((w) => w.path === task.worktreePath)
          : usable.find((w) => w.heldByTaskId === null && !takenThisTurn.has(w.path))
        if (!slot) continue // no free slot right now — a task terminal will re-schedule
        if (task.worktreePath === null && takenThisTurn.has(slot.path)) continue
        takenThisTurn.add(slot.path)
        rt.permits -= 1
        const workerId = `w-${task.taskId}-a${task.attempts + 1}`
        const baseSha = rt.slotHeads.get(slot.path) ?? ""
        // Synchronous apply = claim + slot hold visible to any other schedule() in this turn.
        void this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_task_claimed", timestamp: this.now(), runId,
          taskId: task.taskId, workerId, worktreePath: slot.path, branch: slot.branch,
          baseSha,
        })
        void this.runTask(runId, task.taskId, workerId, slot.path, slot.branch, baseSha)
      }
      this.finishIfTerminal(runId)
    } finally {
      rt.scheduling = false
    }
  }

  /**
   * Drive one claimed task through the phase pipeline. Caller (schedule or
   * recoverOnStartup) has already consumed a permit; the finally releases it.
   * `resume` re-enters a task recovered while paused at a hard gate: the gate
   * is re-notified and awaited BEFORE the loop continues at `fromPhase` with
   * the persisted prior-phase output (F2/F5).
   */
  private async runTask(runId: string, taskId: string, workerId: string, wtPath: string, branch: string, baseSha: string, resume?: GatedResume): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return
    const taskRt: TaskRuntime = { abortController: new AbortController() }
    rt.taskRuntimes.set(taskId, taskRt)
    const run = this.deps.store.getOrchRun(runId)
    if (!run) return
    const config = run.config
    let terminalFailed = false
    try {
      if (resume) {
        const proceed = await this.awaitGate(rt, runId, taskId, resume.pendingGate.phaseIndex, resume.pendingGate.phaseName, resume.pendingGate.kind)
        if (!proceed) return
      }
      // Pool worktree already provisioned (F13) — no per-task ensureWorktree.
      const taskSpec = this.deps.store.getOrchTaskSpec(runId, taskId)
      const taskPrompt = taskSpec?.prompt ?? ""
      const taskScopePaths = taskSpec?.scopePaths ?? []
      let prior = resume?.prior ?? ""
      for (let phaseIndex = resume?.fromPhase ?? 0; phaseIndex < config.phases.length; phaseIndex++) {
        if (rt.cancelled) return
        const phase = config.phases[phaseIndex]!
        const workerIds = Array.from({ length: phase.parallel }, (_, i) =>
          phase.parallel === 1 ? workerId : `${workerId}-p${phaseIndex}-${i + 1}`)
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_phase_started", timestamp: this.now(), runId, taskId,
          phaseIndex, phaseName: phase.name, workerIds,
        })
        // {{DIFF}} anchored at this task's claim baseSha, NOT baseBranch — the
        // pool worktree branch carries earlier tasks' commits (F13).
        const prompt = await this.composePrompt(phase, taskPrompt, prior, wtPath, baseSha, config.contextPrompt, taskScopePaths)
        const results = await Promise.all(workerIds.map((wid) =>
          this.deps.startWorker({
            runId, taskId, workerId: wid, phase, phaseIndex,
            cwd: wtPath, prompt, abortSignal: taskRt.abortController.signal,
          })))
        if (rt.cancelled) return
        const failed = results.find((r): r is Extract<WorkerResult, { kind: "failed" }> => r.kind === "failed")
        if (failed) {
          terminalFailed = true
          await this.deps.store.appendOrchestrationEvent({
            v: 3, type: "orch_task_failed", timestamp: this.now(), runId, taskId, error: failed.error,
          })
          return
        }
        const handedBack = results.find((r): r is Extract<WorkerResult, { kind: "handed_back" }> => r.kind === "handed_back")
        if (handedBack) {
          await this.deps.store.appendOrchestrationEvent({
            v: 3, type: "orch_task_requeued", timestamp: this.now(), runId, taskId,
            reason: "handed_back", detail: handedBack.reason,
          })
          return
        }
        prior = results
          .map((r) => (r.kind === "completed" ? r.text : ""))
          .filter(Boolean)
          .join("\n\n---\n\n")
          .slice(0, MAX_PHASE_OUTPUT_CHARS)
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_phase_completed", timestamp: this.now(), runId, taskId,
          phaseIndex, output: prior, outputChars: prior.length,
          workers: workerIds.map((wid, i) => ({
            workerId: wid,
            subagentRunId: results[i]?.subagentRunId ?? null,
          })),
        })
        const gate = config.gates.find((g) => g.afterPhase === phase.name)
        if (gate) {
          const proceed = await this.awaitGate(rt, runId, taskId, phaseIndex, phase.name, gate.kind)
          if (!proceed) return
        }
      }
      // F12: mechanical verify before commit — engine reads exit code, workers never self-certify.
      if (config.verify && this.deps.runVerify) {
        const passed = await this.runVerifyLoop(rt, runId, taskId, workerId, wtPath, baseSha, config, taskSpec)
        if (!passed) {
          if (!rt.cancelled) terminalFailed = true
          return
        }
      }
      const commit = await this.deps.worktrees.commitAll(wtPath, `orch(${config.title}): ${taskId}`)
      if (commit.kind === "committed") {
        // Advance the slot HEAD — the NEXT task borrowing this slot anchors
        // its {{DIFF}} here (F13).
        rt.slotHeads.set(wtPath, commit.sha)
      }
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_task_committed", timestamp: this.now(), runId, taskId,
        commitSha: commit.kind === "committed" ? commit.sha : null,
      })
    } catch (err) {
      if (!rt.cancelled) {
        terminalFailed = true
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_task_failed", timestamp: this.now(), runId, taskId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      if (terminalFailed && !rt.cancelled) {
        // F13: scrub the failed task's uncommitted junk so the next borrower
        // gets a clean tree. Committed work from earlier tasks is untouched.
        // Best-effort: a reset failure must not block permit release.
        try { await this.deps.worktrees.resetHard(wtPath) } catch { /* logged by adapter */ }
      }
      rt.taskRuntimes.delete(taskId)
      rt.gateResolvers.delete(taskId)
      rt.permits += 1
      this.schedule(runId)
    }
  }

  /**
   * Open a gate and (for hard gates) block until resolved. Returns true to
   * continue the pipeline, false when the task must stop (reject / cancel).
   * The gated task keeps its permit slot while waiting — conservative v1.
   * NOTE: on a resume re-entry the orch_gate_opened event already exists from
   * the previous lifetime; appending again is correct (the re-arm is itself a
   * visible transition, AG3) and folds idempotently (gated -> gated).
   */
  private async awaitGate(rt: RunRuntime, runId: string, taskId: string, phaseIndex: number, phaseName: string, gateKind: OrchGateKind): Promise<boolean> {
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_gate_opened", timestamp: this.now(), runId, taskId,
      phaseIndex, phaseName, gateKind,
    })
    this.deps.onGateOpened?.({ runId, taskId, phaseIndex, phaseName, gateKind })
    if (gateKind === "soft") {
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_gate_resolved", timestamp: this.now(), runId, taskId,
        phaseIndex, decision: "approve",
      })
      return true
    }
    const decision = await new Promise<OrchGateDecision>((resolve) => {
      rt.gateResolvers.set(taskId, resolve)
    })
    if (rt.cancelled) return false
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_gate_resolved", timestamp: this.now(), runId, taskId,
      phaseIndex, decision,
    })
    if (decision === "reject") {
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_task_failed", timestamp: this.now(), runId, taskId,
        error: `hard gate after phase "${phaseName}" rejected`,
      })
      return false
    }
    return true
  }

  private async composePrompt(
    phase: OrchPhaseSpec,
    taskPrompt: string,
    prior: string,
    wtPath: string,
    /** Diff anchor: the task's claim baseSha (F13) — never baseBranch, which would leak earlier tasks' commits into the review diff. */
    baseRef: string,
    /** F11: run-wide shared conventions (Bun PORTING.md pattern) — null = none. */
    contextPrompt: string | null,
    /** F11: declared task file ownership; injected as scope hint for implement phases only. */
    scopePaths: string[],
  ): Promise<string> {
    let prompt = phase.promptTemplate
      .replaceAll("{{TASK}}", taskPrompt)
      .replaceAll("{{PRIOR}}", prior)
    if (prompt.includes("{{DIFF}}")) {
      const diff = await this.deps.worktrees.diffAgainstBase(wtPath, baseRef)
      prompt = prompt.replaceAll("{{DIFF}}", diff)
    }
    // F11: prepend shared conventions to EVERY worker prompt (all phases, all tasks).
    if (contextPrompt) {
      prompt = `${contextPrompt}\n\n---\n\n${prompt}`
    }
    // F11: scope hint only on implement phases — reviewers/fixers see the diff/prior already.
    if (phase.kind === "implement" && scopePaths.length > 0) {
      prompt = `${prompt}\n\nScope (files/dirs you own for this task): ${scopePaths.join(", ")}`
    }
    return prompt
  }

  /**
   * F12: verify loop — runs `config.verify.command` in the worktree after all phases.
   * Exit 0 → returns true (proceed to commit). Non-zero → spawns the last fix phase
   * with verify output as {{PRIOR}}, retries up to `config.verify.retries` times.
   * Exhausted → appends `orch_task_failed` and returns false.
   * Engine reads the exit code — workers never self-certify correctness.
   */
  private async runVerifyLoop(
    rt: RunRuntime,
    runId: string,
    taskId: string,
    workerId: string,
    wtPath: string,
    baseSha: string,
    config: OrchRunConfig,
    taskSpec: { prompt: string; scopePaths: string[] } | null,
  ): Promise<boolean> {
    const spec = config.verify!
    const runVerify = this.deps.runVerify!
    const fixPhaseIndex = config.phases.findLastIndex((p) => p.kind === "fix")
    for (let attempt = 0; attempt <= spec.retries; attempt++) {
      if (rt.cancelled) return false
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_verify_started", timestamp: this.now(), runId, taskId, attempt,
      })
      const result = await runVerify(wtPath, spec.command, spec.timeoutMs)
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_verify_completed", timestamp: this.now(), runId, taskId, attempt,
        passed: result.exitCode === 0,
        outputExcerpt: result.output.slice(0, 2_000),
      })
      if (result.exitCode === 0) return true
      if (attempt >= spec.retries) break
      // Re-run the fix phase with verify output as {{PRIOR}}.
      if (fixPhaseIndex === -1) break // no fix phase in config — escalate immediately
      const fixPhase = config.phases[fixPhaseIndex]!
      const fixWorkerId = `${workerId}-verify-fix-${attempt}`
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_phase_started", timestamp: this.now(), runId, taskId,
        phaseIndex: fixPhaseIndex, phaseName: fixPhase.name, workerIds: [fixWorkerId],
      })
      const verifyPrior = result.output.slice(0, MAX_PHASE_OUTPUT_CHARS)
      const fixPrompt = await this.composePrompt(
        fixPhase, taskSpec?.prompt ?? "", verifyPrior, wtPath, baseSha,
        config.contextPrompt, taskSpec?.scopePaths ?? [],
      )
      const workerResult = await this.deps.startWorker({
        runId, taskId, workerId: fixWorkerId, phase: fixPhase, phaseIndex: fixPhaseIndex,
        cwd: wtPath, prompt: fixPrompt, abortSignal: rt.taskRuntimes.get(taskId)?.abortController.signal ?? new AbortController().signal,
      })
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_phase_completed", timestamp: this.now(), runId, taskId,
        phaseIndex: fixPhaseIndex,
        output: workerResult.kind === "completed" ? workerResult.text : "",
        outputChars: workerResult.kind === "completed" ? workerResult.text.length : 0,
        workers: [{ workerId: fixWorkerId, subagentRunId: workerResult.subagentRunId ?? null }],
      })
      if (workerResult.kind !== "completed") {
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_task_failed", timestamp: this.now(), runId, taskId,
          error: workerResult.kind === "failed" ? workerResult.error : `verify fix handed back (attempt ${attempt})`,
        })
        return false
      }
    }
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_task_failed", timestamp: this.now(), runId, taskId,
      error: `verify step failed after ${spec.retries + 1} attempt(s)`,
    })
    return false
  }

  private finishIfTerminal(runId: string): void {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return
    const run = this.deps.store.getOrchRun(runId)
    if (!run) return
    if (run.status !== "running") {
      rt.done.resolve()
      return
    }
    const allTerminal = run.tasks.every((t) => t.state === "committed" || t.state === "failed")
    const anyInFlight = rt.taskRuntimes.size > 0
    if (allTerminal && !anyInFlight) {
      void this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_run_completed", timestamp: this.now(), runId,
      })
      rt.done.resolve()
      console.log(`${LOG_PREFIX} orchestration run completed`, { runId })
    }
  }
}
```

Note the requeue path: `runTask` returns after appending `orch_task_requeued`, the `finally` releases the permit and calls `schedule(runId)`, which re-claims the queued task (attempts capped by `maxAttempts`). Verified in Task 6.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Lint + commit**

```bash
bun run lint
git add src/server/orchestration-queue.ts src/server/orchestration-queue.test.ts
git commit -m "feat(orchestration): queue engine with own permit pool and atomic claims"
```

---

### Task 5: Phase pipeline — order, fanout, prompt composition

**Files:**
- Modify (test only): `src/server/orchestration-queue.test.ts`

Engine code from Task 4 already implements phases; this task pins the behavior with tests (they must pass against the Task 4 implementation — if any fail, fix the engine, not the test).

- [ ] **Step 1: Add the pipeline describe block**

```ts
describe("OrchestrationQueue phase pipeline", () => {
  test("phases run in declared order, fresh worker ids per phase (F4)", async () => {
    const { store } = await makeStore()
    const calls: Array<{ phaseIndex: number; workerId: string; prompt: string }> = []
    const startWorker: StartWorker = async (args) => {
      calls.push({ phaseIndex: args.phaseIndex, workerId: args.workerId, prompt: args.prompt })
      return { kind: "completed", text: `out-p${args.phaseIndex}` }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 2, promptTemplate: "REVIEW {{DIFF}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{TASK}} FEEDBACK {{PRIOR}}" },
      ],
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)

    expect(calls.map((c) => c.phaseIndex)).toEqual([0, 1, 1, 2])
    // review fanout gets distinct fresh worker ids
    const reviewIds = calls.filter((c) => c.phaseIndex === 1).map((c) => c.workerId)
    expect(new Set(reviewIds).size).toBe(2)
    // prompt composition
    expect(calls[0]!.prompt).toBe("IMPL do 1")
    expect(calls[1]!.prompt).toContain("+fake") // {{DIFF}} from fake ops
    expect(calls[3]!.prompt).toContain("out-p1") // {{PRIOR}} = joined review output
    expect(calls[3]!.prompt).toContain("do 1")
  })

  test("phase failure marks task failed, run still completes (other tasks unaffected)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    const startWorker: StartWorker = async (args) =>
      args.taskId === "t1"
        ? { kind: "failed", error: "boom" }
        : { kind: "completed", text: "ok" }
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig(), tasks(2))
    await q.waitForRun(runId)
    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    const t1 = run.tasks.find((t) => t.taskId === "t1")!
    const t2 = run.tasks.find((t) => t.taskId === "t2")!
    expect(t1.state).toBe("failed")
    expect(t1.error).toBe("boom")
    expect(t2.state).toBe("committed")
    // F13: failed task's uncommitted junk scrubbed so the slot is safe to reuse
    expect(wt.resets).toEqual([t1.worktreePath])
    // and the slot was released back to the pool
    expect(run.worktrees.find((w) => w.path === t1.worktreePath)!.heldByTaskId).toBeNull()
  })

  test("every transition produced a persisted event (AG3)", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types).toEqual([
      "orch_run_created",
      "orch_worktree_provisioned",      // slot 0 (F13)
      "orch_worktree_init_completed",
      "orch_worktree_provisioned",      // slot 1
      "orch_worktree_init_completed",
      "orch_task_claimed",
      "orch_phase_started",
      "orch_phase_completed",
      "orch_task_committed",
      "orch_run_completed",
    ])
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS. If order/composition differs, fix `orchestration-queue.ts` (the spec is the test).

- [ ] **Step 3: Commit**

```bash
git add src/server/orchestration-queue.test.ts
git commit -m "test(orchestration): pin phase order, fanout, prompt composition, AG3 event trail"
```

---

### Task 6: Hand-back + requeue with attempt cap

**Files:**
- Modify (test only, engine fix if needed): `src/server/orchestration-queue.test.ts`

- [ ] **Step 1: Add the hand-back describe block**

```ts
describe("OrchestrationQueue hand-back", () => {
  test("handed_back requeues and a later claim retries with attempt+1", async () => {
    const { store } = await makeStore()
    let firstCall = true
    const startWorker: StartWorker = async () => {
      if (firstCall) {
        firstCall = false
        return { kind: "handed_back", reason: "unknown discovered" }
      }
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(task.attempts).toBe(2)
  })

  test("attempts exhausted -> terminal failed, run completes", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "handed_back", reason: "never learns" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxAttempts: 2 }), tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.attempts).toBe(2)
    expect(task.error).toContain("max attempts")
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("requeued task re-claims its OWN slot — dirty progress never trampled (F13/F2)", async () => {
    const { store } = await makeStore()
    const wt = fakeWorktreeOps()
    let calls = 0
    const startWorker: StartWorker = async () => {
      calls += 1
      return calls === 1 ? { kind: "handed_back", reason: "retry" } : { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: wt, startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    // both claims bound the SAME slot (hold kept across requeue)
    const claims = store.getOrchRunEvents(runId)
      .filter((e): e is Extract<typeof e, { type: "orch_task_claimed" }> => e.type === "orch_task_claimed")
    expect(claims).toHaveLength(2)
    expect(claims[0]!.worktreePath).toBe(claims[1]!.worktreePath)
    // hand-back is NOT a failure — the worktree must never be reset (F2)
    expect(wt.resets).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS (engine from Task 4 handles this via the `finally` → `schedule` loop; fix engine if not).

- [ ] **Step 3: Commit**

```bash
git add src/server/orchestration-queue.test.ts
git commit -m "test(orchestration): hand-back requeue, attempt cap, worktree reuse"
```

---

### Task 6b: Gates (F5) + scope-overlap warning (F6) + gated restart re-arm

**Files:**
- Modify: `src/server/orchestration-queue.test.ts` (new describe blocks)
- Modify: `src/server/orchestration-queue.ts` (engine already carries the gate code from Task 4 — fix it here if any test fails)

Extend the test file's engine import with the notice type:

```ts
import {
  OrchestrationQueue,
  type OrchGateOpenedNotice,
  type OrchWorktreeOps,
  type StartWorker,
} from "./orchestration-queue"
```

- [ ] **Step 1: Write the gate tests**

```ts
describe("OrchestrationQueue gates (F5)", () => {
  const gatedConfig = (kind: "soft" | "hard") => makeConfig({
    phases: [
      { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
      { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
    ],
    gates: [{ afterPhase: "implement", kind }],
  })

  test("hard gate pauses task in gated; approve resumes next phase with prior output", async () => {
    const { store } = await makeStore()
    const notices: OrchGateOpenedNotice[] = []
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: `out-p${args.phaseIndex}` }
    }
    const q = new OrchestrationQueue({
      store, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("gated")
    expect(notices).toHaveLength(1)
    expect(notices[0]!.gateKind).toBe("hard")
    expect(q.resolveGate(runId, "t1", "approve")).toBe(true)
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(prompts[1]).toContain("out-p0") // fix phase saw implement output across the gate
  })

  test("hard gate reject -> task failed with gate error, run completes", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(q.resolveGate(runId, "t1", "reject")).toBe(true)
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.error).toContain('hard gate after phase "implement" rejected')
    expect(store.getOrchRun(runId)!.status).toBe("completed")
  })

  test("soft gate flags and continues without resolution", async () => {
    const { store, dir } = await makeStore()
    const notices: OrchGateOpenedNotice[] = []
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({
      store, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    const runId = await q.createRun(gatedConfig("soft"), tasks(1))
    await q.waitForRun(runId) // no resolveGate call — must complete on its own
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(notices).toHaveLength(1)
    expect(notices[0]!.gateKind).toBe("soft")
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types).toContain("orch_gate_opened")
    expect(types).toContain("orch_gate_resolved")
  })

  test("cancelRun unblocks a hard-gate waiter (AG1: explicit cancel only)", async () => {
    const { store } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(gatedConfig("hard"), tasks(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("gated")
    await q.cancelRun(runId)
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.status).toBe("cancelled")
  })
})

describe("OrchestrationQueue scope overlap (F6)", () => {
  test("overlapping scopePaths emit a soft flag; run proceeds", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), [
      { id: "t1", title: "a", prompt: "a", scopePaths: ["src/a"] },
      { id: "t2", title: "b", prompt: "b", scopePaths: ["src/a/utils.ts"] },
      { id: "t3", title: "c", prompt: "c", scopePaths: ["src/c"] },
    ])
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks.every((t) => t.state === "committed")).toBe(true)
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const flag = log.trim().split("\n")
      .map((l) => JSON.parse(l) as { type: string; taskIds?: string[] })
      .find((e) => e.type === "orch_scope_overlap_flagged")
    expect(flag).toBeDefined()
    expect(flag!.taskIds!.sort()).toEqual(["t1", "t2"])
  })

  test("maxParallelTasks > worktreePoolSize emits a soft config warning; run proceeds", async () => {
    const { store, dir } = await makeStore()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig({ maxParallelTasks: 6, worktreePoolSize: 2 }), [
      { id: "t1", title: "a", prompt: "a" },
    ])
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.status).toBe("completed")
    await store.flush()
    const log = await Bun.file(path.join(dir, "orch.jsonl")).text()
    const warn = log.trim().split("\n")
      .map((l) => JSON.parse(l) as { type: string; message?: string })
      .find((e) => e.type === "orch_config_warning")
    expect(warn).toBeDefined()
    expect(warn!.message).toContain("capped at 2")
  })
})

describe("OrchestrationQueue gated restart re-arm (F2+F5)", () => {
  test("boot with task paused at hard gate: gate re-notified, approve resumes with persisted prior", async () => {
    const { store, dir } = await makeStore()
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      gates: [{ afterPhase: "implement", kind: "hard" }],
    })
    // Previous lifetime: implement done, gate opened, then crash.
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config, tasks: [{ id: "t1", title: "a", prompt: "do a" }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-old", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-old"],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_completed", timestamp: 4, runId: "r1", taskId: "t1",
      phaseIndex: 0, output: "impl out", outputChars: 8,
      workers: [{ workerId: "w-old", subagentRunId: null }],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_gate_opened", timestamp: 5, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", gateKind: "hard",
    })
    await store.flush()

    const reopened = new EventStore(dir)
    await reopened.initialize()
    expect(reopened.getOrchRun("r1")!.tasks[0]!.state).toBe("gated")

    const notices: OrchGateOpenedNotice[] = []
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "fixed" }
    }
    const q = new OrchestrationQueue({
      store: reopened, worktrees: fakeWorktreeOps(), startWorker,
      onGateOpened: (n) => notices.push(n),
    })
    await q.recoverOnStartup()
    await new Promise((r) => setTimeout(r, 20))
    expect(notices).toHaveLength(1) // gate re-notified, task NOT requeued
    expect(reopened.getOrchRun("r1")!.tasks[0]!.state).toBe("gated")

    expect(q.resolveGate("r1", "t1", "approve")).toBe(true)
    await q.waitForRun("r1")
    const task = reopened.getOrchRun("r1")!.tasks[0]!
    expect(task.state).toBe("committed")
    expect(prompts).toHaveLength(1) // only the fix phase ran after resume
    expect(prompts[0]).toContain("impl out") // persisted {{PRIOR}} survived the restart
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS against the Task 4 engine. Failures = engine bugs; fix `orchestration-queue.ts`, not the tests.

- [ ] **Step 3: Unit-test detectScopeOverlap edge cases**

Add to the same file:

```ts
describe("detectScopeOverlap", () => {
  test("disjoint -> null", () => {
    expect(detectScopeOverlap([
      { id: "a", title: "a", prompt: "a", scopePaths: ["src/a"] },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src/b"] },
    ])).toBeNull()
  })
  test("prefix normalization: ./src/a/ overlaps src/a/x.ts", () => {
    const hit = detectScopeOverlap([
      { id: "a", title: "a", prompt: "a", scopePaths: ["./src/a/"] },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src/a/x.ts"] },
    ])
    expect(hit?.taskIds.sort()).toEqual(["a", "b"])
  })
  test("missing scopePaths never overlap", () => {
    expect(detectScopeOverlap([
      { id: "a", title: "a", prompt: "a" },
      { id: "b", title: "b", prompt: "b", scopePaths: ["src"] },
    ])).toBeNull()
  })
})
```

Import `detectScopeOverlap` from `./orchestration-queue` in the test file's import block.

- [ ] **Step 4: Run tests**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Lint + commit**

```bash
bun run lint
git add src/server/orchestration-queue.ts src/server/orchestration-queue.test.ts
git commit -m "feat(orchestration): soft/hard phase gates, scope-overlap flag, gated restart re-arm"
```

---

### Task 6c: Verify step (F12) + contextPrompt / scopePaths injection (F11)

**Files:**
- Modify (test + engine fix if any): `src/server/orchestration-queue.test.ts`
- Possibly modify: `src/server/orchestration-queue.ts` (engine already carries the verify + injection code from Task 4 amendments — fix it here if any test fails)

- [ ] **Step 1: Add the verify + context describe blocks**

```ts
describe("OrchestrationQueue verify step (F12)", () => {
  test("verify passing -> task committed, verify events in timeline", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => { verifyCalls++; return { exitCode: 0, output: "ok" } }
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const config = makeConfig({
      phases: [{ name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" }],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(1)
    const events = store.getOrchRunEvents(runId)
    expect(events.some((e) => e.type === "orch_verify_started")).toBe(true)
    expect(events.some((e) => e.type === "orch_verify_completed" && (e as { passed: boolean }).passed)).toBe(true)
  })

  test("verify fail then pass after fix retry -> committed (retries = 1)", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => {
      verifyCalls++
      return verifyCalls === 1 ? { exitCode: 1, output: "FAIL: missing x" } : { exitCode: 0, output: "ok" }
    }
    const fixPrompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      if (args.phase.kind === "fix") fixPrompts.push(args.prompt)
      return { kind: "completed", text: "fixed" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(2)
    // Verify output fed as {{PRIOR}} into the fix phase
    expect(fixPrompts.at(-1)).toContain("FAIL: missing x")
  })

  test("verify fails all retries -> task failed", async () => {
    const { store } = await makeStore()
    const runVerify = async () => ({ exitCode: 1, output: "always fail" })
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      verify: { command: ["check"], timeoutMs: 1_000, retries: 1 },
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    const task = store.getOrchRun(runId)!.tasks[0]!
    expect(task.state).toBe("failed")
    expect(task.error).toContain("verify step failed")
  })

  test("verify = null skips the step even when runVerify is present", async () => {
    const { store } = await makeStore()
    let verifyCalls = 0
    const runVerify = async () => { verifyCalls++; return { exitCode: 0, output: "" } }
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker, runVerify })
    const runId = await q.createRun(makeConfig({ verify: null }), tasks(1))
    await q.waitForRun(runId)
    expect(store.getOrchRun(runId)!.tasks[0]!.state).toBe("committed")
    expect(verifyCalls).toBe(0)
  })
})

describe("OrchestrationQueue contextPrompt + scopePaths injection (F11)", () => {
  test("contextPrompt prefix injected into every worker prompt across all phases", async () => {
    const { store } = await makeStore()
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "ok" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 1, promptTemplate: "REVIEW {{DIFF}}" },
      ],
      contextPrompt: "SHARED CONVENTIONS: always use TypeScript strict mode",
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, tasks(1))
    await q.waitForRun(runId)
    expect(prompts).toHaveLength(2)
    // Every prompt starts with the shared conventions block
    for (const p of prompts) {
      expect(p).toContain("SHARED CONVENTIONS")
    }
  })

  test("implement phase receives scope hint; non-implement phases do not", async () => {
    const { store } = await makeStore()
    const byPhase: Record<string, string> = {}
    const startWorker: StartWorker = async (args) => {
      byPhase[args.phase.name] = args.prompt
      return { kind: "completed", text: "ok" }
    }
    const config = makeConfig({
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 1, promptTemplate: "REVIEW {{DIFF}}" },
      ],
    })
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(config, [
      { id: "t1", title: "task", prompt: "do task", scopePaths: ["src/auth", "src/session"] },
    ])
    await q.waitForRun(runId)
    // Implementer sees the scope hint
    expect(byPhase["implement"]).toContain("src/auth")
    expect(byPhase["implement"]).toContain("src/session")
    // Reviewer does NOT (they see the diff instead)
    expect(byPhase["review"]).not.toContain("src/auth")
  })

  test("contextPrompt = null and empty scopePaths add nothing to prompt", async () => {
    const { store } = await makeStore()
    const prompts: string[] = []
    const startWorker: StartWorker = async (args) => {
      prompts.push(args.prompt)
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await q.waitForRun(runId)
    // Prompt is exactly the template substitution — no extra prefix or scope line
    expect(prompts[0]).toBe("IMPL do 1")
  })
})
```

- [ ] **Step 2: Run tests**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS against the Task 4 engine (amended for F11/F12). Failures = engine bugs; fix `orchestration-queue.ts`, not the tests.

- [ ] **Step 3: Lint + commit**

```bash
bun run lint
git add src/server/orchestration-queue.ts src/server/orchestration-queue.test.ts
git commit -m "feat(orchestration): verify step (F12) + contextPrompt/scopePaths injection (F11)"
```

---

### Task 7: Cancel cascade (AG1 semantics)

**Files:**
- Modify: `src/server/orchestration-queue.ts` (add `cancelRun`)
- Test: `src/server/orchestration-queue.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("OrchestrationQueue cancel", () => {
  test("cancelRun aborts in-flight workers via signal and marks run cancelled", async () => {
    const { store } = await makeStore()
    let sawAbort = false
    const startWorker: StartWorker = async (args) => {
      await new Promise<void>((resolve) => {
        args.abortSignal.addEventListener("abort", () => { sawAbort = true; resolve() })
      })
      return { kind: "failed", error: "aborted" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(1))
    await new Promise((r) => setTimeout(r, 20)) // let claim + phase start
    await q.cancelRun(runId)
    await q.waitForRun(runId)
    expect(sawAbort).toBe(true)
    expect(store.getOrchRun(runId)!.status).toBe("cancelled")
  })

  test("no worker is ever aborted WITHOUT cancelRun (AG1)", async () => {
    const { store } = await makeStore()
    let aborted = 0
    const startWorker: StartWorker = async (args) => {
      args.abortSignal.addEventListener("abort", () => { aborted += 1 })
      return { kind: "completed", text: "ok" }
    }
    const q = new OrchestrationQueue({ store, worktrees: fakeWorktreeOps(), startWorker })
    const runId = await q.createRun(makeConfig(), tasks(3))
    await q.waitForRun(runId)
    expect(aborted).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify the first test fails**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: FAIL — `q.cancelRun is not a function`

- [ ] **Step 3: Implement `cancelRun`**

Add to `OrchestrationQueue`:

```ts
  /**
   * Explicit cancel — the ONLY path that aborts in-flight workers (AG1).
   * Aborts every task's AbortController, appends orch_run_cancelled, resolves
   * waiters. In-flight runTask bodies see rt.cancelled and stop persisting
   * task-level transitions.
   */
  async cancelRun(runId: string): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt || rt.cancelled) return
    rt.cancelled = true
    for (const taskRt of rt.taskRuntimes.values()) {
      taskRt.abortController.abort()
    }
    // Unblock any hard-gate waiters; awaitGate sees rt.cancelled and stops
    // without persisting a resolution.
    for (const [taskId, resolve] of rt.gateResolvers) {
      rt.gateResolvers.delete(taskId)
      resolve("reject")
    }
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_run_cancelled", timestamp: this.now(), runId,
    })
    rt.done.resolve()
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/orchestration-queue.ts src/server/orchestration-queue.test.ts
git commit -m "feat(orchestration): explicit cancel cascade, AG1 no-kill-without-cancel"
```

---

### Task 8: Restart recovery — re-queue with progress kept (F2, AG2)

**Files:**
- Modify: `src/server/orchestration-queue.ts` (add `recoverOnStartup` + `resumeRuns`)
- Test: `src/server/orchestration-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("OrchestrationQueue restart recovery", () => {
  test("boot after crash: in-flight tasks requeued (owner cleared, worktree kept), run resumes to completion (F2/AG2)", async () => {
    const { store, dir } = await makeStore()
    // Simulate a previous lifetime: run created, t1 claimed + mid-phase, t2 committed.
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_run_created", timestamp: 1, runId: "r1",
      config: makeConfig({ maxAttempts: 3 }),
      tasks: [
        { id: "t1", title: "a", prompt: "do a" },
        { id: "t2", title: "b", prompt: "do b" },
      ],
    })
    // Pool of the previous lifetime (F13) — slots must exist for the scheduler.
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_worktree_provisioned", timestamp: 1, runId: "r1",
      index: 0, path: "/wt/t1", branch: "orch/r1/wt-0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_worktree_init_completed", timestamp: 1, runId: "r1",
      index: 0, ok: true, outputExcerpt: "",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_worktree_provisioned", timestamp: 1, runId: "r1",
      index: 1, path: "/wt/t2", branch: "orch/r1/wt-1",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_worktree_init_completed", timestamp: 1, runId: "r1",
      index: 1, ok: true, outputExcerpt: "",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 2, runId: "r1", taskId: "t1",
      workerId: "w-old", worktreePath: "/wt/t1", branch: "orch/r1/wt-0", baseSha: "base0",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_phase_started", timestamp: 3, runId: "r1", taskId: "t1",
      phaseIndex: 0, phaseName: "implement", workerIds: ["w-old"],
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_claimed", timestamp: 4, runId: "r1", taskId: "t2",
      workerId: "w-old2", worktreePath: "/wt/t2", branch: "orch/r1/wt-1", baseSha: "base1",
    })
    await store.appendOrchestrationEvent({
      v: 3, type: "orch_task_committed", timestamp: 5, runId: "r1", taskId: "t2", commitSha: "sha2",
    })
    await store.flush()

    // "Reboot": fresh store replays the log, fresh engine recovers.
    const reopened = new EventStore(dir)
    await reopened.initialize()
    const wt = fakeWorktreeOps()
    const startWorker: StartWorker = async () => ({ kind: "completed", text: "ok" })
    const q = new OrchestrationQueue({ store: reopened, worktrees: wt, startWorker })
    await q.recoverOnStartup()

    const afterRecovery = reopened.getOrchRun("r1")!
    const t1 = afterRecovery.tasks.find((t) => t.taskId === "t1")!
    expect(t1.ownerWorkerId).toBeNull()          // owner cleared
    expect(t1.worktreePath).toBe("/wt/t1")       // progress kept
    // zero orphans: nothing left claimed/running with no live worker
    expect([...reopened.nonTerminalOrchTasks()]).toHaveLength(0)

    await q.waitForRun("r1")
    const final = reopened.getOrchRun("r1")!
    expect(final.status).toBe("completed")
    expect(final.tasks.find((t) => t.taskId === "t1")!.state).toBe("committed")
    expect(final.tasks.find((t) => t.taskId === "t2")!.state).toBe("committed") // untouched
    expect(final.tasks.find((t) => t.taskId === "t1")!.attempts).toBe(2)
    // recovery reused the recorded worktree path
    expect(wt.added[0]).toBe("/wt/t1")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: FAIL — `q.recoverOnStartup is not a function`

- [ ] **Step 3: Implement recovery**

Add to `OrchestrationQueue`:

```ts
  /**
   * Boot recovery (F2): every task left claimed/running by a previous server
   * lifetime is re-queued — owner cleared, worktree/branch/attempts kept —
   * then every still-running run is re-armed so the scheduler resumes it.
   * Call once on server startup, before any createRun.
   */
  async recoverOnStartup(): Promise<void> {
    // 1. Re-queue in-flight (claimed/running) tasks — owner cleared, worktree
    //    + attempts kept (F2). Collect first: the append mutates the maps the
    //    generator walks. `gated` tasks are NOT requeued (step 3 re-arms them).
    for (const pending of [...this.deps.store.nonTerminalOrchTasks()]) {
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_task_requeued", timestamp: this.now(),
        runId: pending.runId, taskId: pending.taskId,
        reason: "restart_recovery", detail: "server restart while task was in flight",
      })
      console.log(`${LOG_PREFIX} orchestration task requeued on boot`, pending)
    }
    // 2. Create runtimes WITHOUT scheduling yet, so gated resumes claim their
    //    permit slots before the queue claims fresh tasks. Rebuild the pool:
    //    ensureWorktree is idempotent — an existing checkout is reused with its
    //    dirty progress intact (F2); a deleted one is re-created from its
    //    branch. The returned headSha reseeds slotHeads for future claims.
    for (const run of this.deps.store.getOrchRuns()) {
      if (run.status !== "running") continue
      const rt = this.ensureRunRuntime(run.runId, run.config)
      for (const slot of run.worktrees) {
        const wt = await this.deps.worktrees.ensureWorktree(
          run.config.repoRoot, slot.branch, slot.path, run.config.baseBranch,
        )
        rt.slotHeads.set(slot.path, wt.headSha)
      }
      rt.poolReady = true
    }
    // 3. Re-arm gated tasks in place: re-notify the gate, await resolution,
    //    resume at the next phase with the persisted prior output (F5).
    for (const gated of [...this.deps.store.gatedOrchTasks()]) {
      const run = this.deps.store.getOrchRun(gated.runId)
      const rt = this.runRuntimes.get(gated.runId)
      if (!run || !rt) continue
      const task = run.tasks.find((t) => t.taskId === gated.taskId)
      if (!task?.worktreePath || !task.branch) continue
      const phase = run.config.phases[gated.phaseIndex]
      const gate = run.config.gates.find((g) => g.afterPhase === phase?.name)
      rt.permits -= 1
      void this.runTask(
        gated.runId, gated.taskId,
        `w-${gated.taskId}-a${task.attempts}-resume`,
        task.worktreePath, task.branch,
        task.baseSha ?? "",
        {
          fromPhase: gated.phaseIndex + 1,
          prior: this.deps.store.getOrchLastPhaseOutput(gated.runId, gated.taskId) ?? "",
          pendingGate: { phaseIndex: gated.phaseIndex, phaseName: phase?.name ?? "", kind: gate?.kind ?? "hard" },
        },
      )
      console.log(`${LOG_PREFIX} orchestration gate re-armed on boot`, gated)
    }
    // 4. Now let every recovered run schedule its queued tasks.
    for (const runId of this.runRuntimes.keys()) {
      this.schedule(runId)
    }
  }
```


- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --conditions production src/server/orchestration-queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/orchestration-queue.ts src/server/orchestration-queue.test.ts
git commit -m "feat(orchestration): restart recovery requeues in-flight tasks, zero orphans"
```

---

### Task 9: Real-worktree adapter for the engine port + integration test

**Files:**
- Create: `src/server/orchestration-worktree.adapter.ts`
- Test: `src/server/orchestration-worktree.adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/orchestration-worktree.adapter.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-wt-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration-worktree.adapter", () => {
  test("ensureWorktree creates a new branch worktree and returns HEAD sha", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    const wt = await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    expect(existsSync(path.join(wt.path, "README.md"))).toBe(true)
    expect(wt.branch).toBe("orch/r1/t1")
    expect(wt.headSha).toMatch(/^[0-9a-f]{7,40}$/)
  }, 30_000)

  test("resetHard scrubs tracked + untracked junk, keeps committed work (F13)", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "committed.txt"), "keep\n")
    await ops.commitAll(wtPath, "orch: keep")
    writeFileSync(path.join(wtPath, "junk.txt"), "junk\n")           // untracked
    writeFileSync(path.join(wtPath, "committed.txt"), "modified\n")  // tracked change
    await ops.resetHard(wtPath)
    expect(existsSync(path.join(wtPath, "junk.txt"))).toBe(false)
    const status = await runGit(["status", "--porcelain"], wtPath)
    expect(status.stdout.trim()).toBe("")
    expect(existsSync(path.join(wtPath, "committed.txt"))).toBe(true)
  }, 30_000)

  test("ensureWorktree is idempotent — reuses an existing worktree (restart recovery)", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "progress.txt"), "half done\n")
    const again = await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    expect(again.path).toBe(wtPath)
    expect(existsSync(path.join(wtPath, "progress.txt"))).toBe(true) // progress kept (F2)
  }, 30_000)

  test("commitAll + diffAgainstBase round-trip through the real repo", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "feature.ts"), "export const x = 1\n")
    const diff = await ops.diffAgainstBase(wtPath, "main")
    expect(diff).toContain("feature.ts")
    const commit = await ops.commitAll(wtPath, "orch: t1")
    expect(commit.kind).toBe("committed")
  }, 30_000)

  test("removeWorktree removes it", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    await ops.removeWorktree(repo, wtPath)
    const list = await runGit(["worktree", "list", "--porcelain"], repo)
    expect(list.stdout).not.toContain(wtPath)
  }, 30_000)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/server/orchestration-worktree.adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the adapter**

```ts
// src/server/orchestration-worktree.adapter.ts
import { mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { OrchWorktreeOps } from "./orchestration-queue"
import { addWorktree, listWorktrees, removeWorktree } from "./worktree-store.adapter"
import { commitAll, diffAgainstBase } from "./orchestration-git.adapter"
import { runGit, formatGitFailure } from "./diff-store"

/**
 * Real-git implementation of the engine's OrchWorktreeOps port. Leaf adapter —
 * composes the existing worktree + orchestration-git adapters. ensureWorktree
 * is idempotent: an existing checkout (pool restart recovery) is reused
 * untouched — uncommitted progress survives (F2/F13).
 */
export function createOrchWorktreeOps(): OrchWorktreeOps {
  async function headOf(wtPath: string): Promise<string> {
    const rev = await runGit(["rev-parse", "HEAD"], wtPath)
    if (rev.exitCode !== 0) throw new Error(formatGitFailure(rev) || "git rev-parse HEAD failed")
    return rev.stdout.trim()
  }
  return {
    async ensureWorktree(repoRoot, branch, wtPath, base) {
      if (existsSync(path.join(wtPath, ".git"))) {
        return { path: wtPath, branch, headSha: await headOf(wtPath) }
      }
      const existing = await listWorktrees(repoRoot)
      const byBranch = existing.find((w) => w.branch === branch)
      if (byBranch) return { path: byBranch.path, branch, headSha: await headOf(byBranch.path) }
      mkdirSync(path.dirname(wtPath), { recursive: true })
      // Branch may survive a removed worktree (restart cleanup) — probe the ref.
      const branchProbe = await runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot)
      const created = await addWorktree(
        repoRoot,
        branchProbe.exitCode === 0
          ? { kind: "existing-branch", branch, path: wtPath }
          : { kind: "new-branch", branch, path: wtPath, base },
      )
      return { path: created.path, branch, headSha: await headOf(created.path) }
    },
    async removeWorktree(repoRoot, wtPath) {
      await removeWorktree(repoRoot, wtPath, { force: true })
    },
    commitAll,
    diffAgainstBase,
    async resetHard(wtPath) {
      // Scrub a terminally-failed task's junk (F13): tracked changes reset,
      // untracked files removed. Committed work on the slot branch untouched.
      const reset = await runGit(["reset", "--hard", "HEAD"], wtPath)
      if (reset.exitCode !== 0) throw new Error(formatGitFailure(reset) || "git reset --hard failed")
      const clean = await runGit(["clean", "-fd"], wtPath)
      if (clean.exitCode !== 0) throw new Error(formatGitFailure(clean) || "git clean failed")
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --conditions production src/server/orchestration-worktree.adapter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/orchestration-worktree.adapter.ts src/server/orchestration-worktree.adapter.test.ts
git commit -m "feat(orchestration): real-git worktree port adapter, idempotent ensure"
```

---

### Task 10: End-to-end integration test — real git, fake workers, full pipeline

**Files:**
- Create: `src/server/orchestration-e2e.test.ts`

This is the CI acceptance test for Plan A's slice of the objective: 4 parallel tasks in isolated worktrees, 3-phase pipeline, restart survival, full event trail.

- [ ] **Step 1: Write the test**

```ts
// src/server/orchestration-e2e.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { runGit } from "./diff-store"
import { OrchestrationQueue, type StartWorker } from "./orchestration-queue"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"
import type { OrchRunConfig } from "../shared/orchestration-types"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-e2e-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "e2e\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration e2e (real worktrees, fake workers)", () => {
  test("4 tasks, 3 phases, isolated worktrees, all committed, full event trail", async () => {
    const repo = await makeRepo()
    const storeDir = mkdtempSync(path.join(tmpdir(), "kanna-orch-e2e-store-"))
    const store = new EventStore(storeDir)
    await store.initialize()

    const cwdsSeen = new Set<string>()
    // Fake worker: implement phase writes a real file into its worktree.
    const startWorker: StartWorker = async (args) => {
      cwdsSeen.add(args.cwd)
      if (args.phase.kind === "implement") {
        writeFileSync(path.join(args.cwd, `${args.taskId}.txt`), `work for ${args.taskId}\n`)
      }
      return { kind: "completed", text: `${args.phase.name} ok` }
    }

    const config: OrchRunConfig = {
      title: "e2e",
      repoRoot: repo,
      baseBranch: "main",
      maxParallelTasks: 4,
      worktreePoolSize: 4,
      maxAttempts: 3,
      phases: [
        { name: "implement", kind: "implement", parallel: 1, promptTemplate: "IMPL {{TASK}}" },
        { name: "review", kind: "review", parallel: 2, promptTemplate: "REVIEW {{DIFF}}" },
        { name: "fix", kind: "fix", parallel: 1, promptTemplate: "FIX {{PRIOR}}" },
      ],
      gates: [],
      contextPrompt: null,
      verify: null,
      init: null,
    }
    const q = new OrchestrationQueue({ store, worktrees: createOrchWorktreeOps(), startWorker })
    const runId = await q.createRun(config, [
      { id: "t1", title: "one", prompt: "do one" },
      { id: "t2", title: "two", prompt: "do two" },
      { id: "t3", title: "three", prompt: "do three" },
      { id: "t4", title: "four", prompt: "do four" },
    ])
    await q.waitForRun(runId)

    const run = store.getOrchRun(runId)!
    expect(run.status).toBe("completed")
    expect(run.tasks.map((t) => t.state)).toEqual(["committed", "committed", "committed", "committed"])
    // pool isolation (F13): 4 slots, 4 concurrent tasks -> 4 distinct cwds (CKR-1)
    expect(run.worktrees).toHaveLength(4)
    expect(cwdsSeen.size).toBe(4)
    // each slot branch really holds its task's commit
    for (const task of run.tasks) {
      expect(task.commitSha).toMatch(/^[0-9a-f]{7,40}$/)
      const show = await runGit(["show", "--stat", task.commitSha!], repo)
      expect(show.stdout).toContain(`${task.taskId}.txt`)
    }
    // F14: worktrees survive run completion — user inspects, then PRs (one per slot branch)
    for (const slot of run.worktrees) {
      expect(existsSync(path.join(slot.path, ".git"))).toBe(true)
    }
    // AG3: full event trail on disk
    await store.flush()
    const log = await Bun.file(path.join(storeDir, "orch.jsonl")).text()
    const types = log.trim().split("\n").map((l) => (JSON.parse(l) as { type: string }).type)
    expect(types.filter((t) => t === "orch_worktree_provisioned")).toHaveLength(4)
    expect(types.filter((t) => t === "orch_task_claimed")).toHaveLength(4)
    expect(types.filter((t) => t === "orch_phase_started")).toHaveLength(12) // 4 tasks x 3 phases
    expect(types.filter((t) => t === "orch_task_committed")).toHaveLength(4)
    expect(types.at(-1)).toBe("orch_run_completed")
  }, 60_000)
})
```

- [ ] **Step 2: Run the test**

Run: `bun test --conditions production src/server/orchestration-e2e.test.ts`
Expected: PASS. Debug failures with the systematic-debugging skill — do not weaken assertions.

- [ ] **Step 3: Full suite + lint (AG4 gate)**

Run: `bun run test && bun run lint`
Expected: everything green. Pre-existing failures → STOP and report (per user's global rules), don't work around.

- [ ] **Step 4: Commit**

```bash
git add src/server/orchestration-e2e.test.ts
git commit -m "test(orchestration): e2e acceptance - 4 worktree-isolated tasks through 3-phase pipeline"
```

---

### Task 11: C3 change-unit + CLAUDE.md doc sync

**Files:**
- Modify: `.c3/` via `c3 change` CLI (never hand-edit)
- Modify: `CLAUDE.md` (new section)

- [ ] **Step 1: Author the change-unit**

Run `/c3 change` (c3-skill): declare a new component (suggested slug `orchestration-core`, parent container Server c3-2) covering `src/server/orchestration-queue.ts`, `src/server/orchestration-git.adapter.ts`, `src/server/orchestration-worktree.adapter.ts`, `src/shared/orchestration-types.ts`, plus the events.ts / event-store.ts extensions. Author an ADR `adr-20260710-orchestration-core` recording: global-run-entity decision (F1), re-queue recovery (F2), own permit pool (F3), fresh-spawn-per-phase (F4), sync-apply claim atomicity, orch.jsonl sourceIndex 8 not-in-snapshot. Cite refs: ref-event-sourcing, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test. Apply with `c3 change apply`.

- [ ] **Step 2: Add CLAUDE.md section**

Append after the "Background Subagents" section:

```markdown
# Orchestration Core (Plan A — engine only)

`OrchestrationQueue` (src/server/orchestration-queue.ts) runs a durable global
task queue: N configurable parallel tasks (`maxParallelTasks`, own permit pool
— NOT SubagentOrchestrator's) claimed into a pre-provisioned **worktree pool**
(F13): `worktreePoolSize` worktrees created up front at `createRun`, each on
branch `orch/<runId>/wt-<i>` under `.kanna-worktrees/`, optionally env-inited
once via `config.init` (e.g. `bun install`, amortized across tasks). A claim
binds task + free slot in ONE synchronous event apply — no two tasks ever
share a slot (thread safety without locks). Commits from successive tasks
stack on the slot's branch; each task's review `{{DIFF}}` anchors at its
per-claim `baseSha`, never `baseBranch`. Slot released on committed/failed
(failure scrubs uncommitted junk via `resetHard`); hand-back/requeue KEEPS the
slot hold so uncommitted progress survives (F2). Run end leaves all worktrees
in place — the user inspects and triggers one PR per worktree branch (F14,
Plan B/C). Each task runs a configurable phase pipeline (default implement →
2x adversarial review → fix) with fresh workers per phase; per-phase
`provider`/`model` override which model executes a phase. Every transition is
an `OrchestrationEvent` persisted to `orch.jsonl` (sourceIndex 8, pure log
replay, not in snapshot). Claims apply synchronously before the disk append
(same pattern as appendSubagentEvent) — single-owner atomicity within one
event-loop turn.
Phase-boundary gates: `hard` pauses the task in `gated` (durable) until
`resolveGate(runId, taskId, approve|reject)`; `soft` emits the gate events and
continues. Gates never abort an in-flight worker. Task `scopePaths` overlap is
flagged soft at run creation (`orch_scope_overlap_flagged`), never refused.
Restart: `recoverOnStartup()` re-queues in-flight tasks (owner cleared,
worktree + attempts kept), re-arms gated tasks in place (gate re-notified,
resume at next phase with the persisted prior-phase output), and re-arms
running runs. Cancel is the only path that aborts workers or force-rejects
gates. Observability: the full per-run event timeline is retained in memory
(`getOrchRunEvents`, rebuilt by replay) for rich drill-in;
`orch_phase_completed.workers[]` links each worker to its subagent run so the
panel reuses the subagent transcript viewer.
Worker context (F11): `OrchRunConfig.contextPrompt` (null = none) is prepended
to EVERY worker prompt across all tasks and phases (Bun PORTING.md pattern —
run-wide shared conventions). `OrchTaskSpec.scopePaths` injects a scope hint
only into `implement`-kind phases so implementers know which files they own.
Verify step (F12): `OrchRunConfig.verify` (`{ command, timeoutMs, retries }`)
runs after the final phase in the task's worktree; exit 0 → commit; non-zero →
re-runs the last `fix`-kind phase with the verify output as `{{PRIOR}}`, up to
`retries` times; exhausted → `orch_task_failed`. The engine reads the exit
code — workers never self-certify. Injected via `runVerify` dep (leaf adapter in Plan B).
Workers are an injected `StartWorker` port — real Claude workers, the
`orch_hand_back` worker MCP tool, launch MCP tools + gate approval UI land in
Plan B; WS topic + panel in Plan C.
```

- [ ] **Step 3: Commit**

```bash
git add .c3 CLAUDE.md
git commit -m "docs(orchestration): c3 change-unit + CLAUDE.md for orchestration core"
```

---

### Task 12: PR

- [ ] **Step 1: Final verification (AG4)**

Run: `bun run test && bun run lint`
Expected: green.

- [ ] **Step 2: Push + PR to the fork**

```bash
git push -u origin feat/orchestration-core
gh pr create --repo cuongtranba/kanna --base main --head feat/orchestration-core \
  --title "feat: orchestration core - durable task queue with worktree-isolated phase pipeline" \
  --body "$(cat <<'EOF'
## Summary
- Durable orchestration engine (Bun-in-Rust pattern): global task queue, N configurable parallel tasks in isolated git worktrees, configurable phase pipeline (implement -> 2x adversarial review -> fix), fresh worker per phase
- New orch.jsonl event log (sourceIndex 8): every state transition persisted; sync-apply claims = single-owner atomicity; restart recovery re-queues in-flight tasks with progress kept
- Workers are an injected port - Plan B wires real Claude workers + MCP launch tools; Plan C adds the UI panel

## Test plan
- [ ] bun run test green (unit: store fold, scheduling, permits, phases, hand-back, cancel, recovery; e2e: 4 real worktrees through 3 phases)
- [ ] bun run lint green
EOF
)"
```

PR creation requires human approval per the ratified action envelope — ask before running `gh pr create`.

---

## Verification against the frame

| Frame item | Where proven |
|---|---|
| OBJ-1 configurable workers/phases | `OrchRunConfig.maxParallelTasks` + `phases[]`; permit test at 2, e2e at 4 |
| OBJ-2 ≥4 parallel isolated worktrees | Task 10 e2e (4 distinct cwds, per-branch commits) |
| OBJ-3 ≥3 phases | Task 5 + Task 10 (12 phase_started events) |
| OBJ-4 E2E test in CI | Task 10 runs under `bun run test` = CI suite |
| OBJ-5 100% terminal states | `waitForRun` + every test asserts terminal |
| AG1 no kill without cancel | Task 7 second test (aborted === 0) |
| AG2 zero orphans post-restart | Task 8 (`nonTerminalOrchTasks` empty after recovery) + Task 2 replay test |
| AG3 no invisible transitions | Task 5 + Task 10 event-trail assertions; gates emit opened/resolved events (Task 6b) |
| AG4 lint+test every commit | every task ends with test+lint before commit |
| F5 soft/hard gates | Task 6b: hard pause/approve/reject, soft flag-and-continue, cancel unblock, gated restart re-arm |
| F6 scopePaths overlap = soft warn | Task 6b: overlap flag event + run proceeds + detectScopeOverlap edges |
| F8 rich drill-in timeline | Task 2: `eventLog` fold + `getOrchRunEvents` + replay-rebuild test |
| F10 worker → subagent transcript link | `WorkerResult.subagentRunId` → `orch_phase_completed.workers[]` (port + event shaped now; real ids in Plan B) |
| F11 contextPrompt + scopePaths injection | Task 6c: contextPrompt prefix in every prompt; scope hint on implement only; null/empty = no change |
| F12 verify step before commit | Task 6c: verify pass → commit; fail → fix retry with verify output as {{PRIOR}}; exhausted → task_failed; engine reads exit code (no self-certification) |
| F13 worktree pool + thread-safe slot claims | Task 4: pool provisioning test (slots + branches + init), never-share-slot concurrency test; Task 6: requeue re-claims own slot, no reset on hand-back; Task 5: failed task reset + slot release; Task 8: pool rebuild on recovery |
| F14 worktrees survive run end (PR per worktree) | Task 10 e2e: pool dirs exist after orch_run_completed; PR trigger itself is Plan B/C |
| Amendment A env init | Task 4 provisioning: orch_worktree_init_* events; unusable-pool fail-fast in scheduler |
| Starved-permit soft warn | Task 6b: `orch_config_warning` when maxParallelTasks > worktreePoolSize; run proceeds, parallelism capped at pool size |
| Amendment B per-phase provider/model | `OrchPhaseSpec.provider/model` typed now; consumed by Plan B real StartWorker |

Out of scope (Plan B): real Claude workers via `buildSubagentProviderRun` (fills `subagentRunId`, honors per-phase `provider`/`model`, enforces per-worker timeout via existing `runTimeoutMs` machinery), `mcp__kanna__orch_hand_back({reason})` worker tool (F9) mapped to `{kind:"handed_back"}`, real `runVerify`/`runInit` spawn adapter (`orchestration-exec.adapter.ts`), MCP tools (`start_orchestration`/`cancel_orchestration`/`resolve_orchestration_gate`/status), F14 delivery: `open_orchestration_pr` per worktree branch via `gh` port (user-triggered — action envelope requires PR approval) + run-completion summary (per-task sha/branch/failure) delivered to the origin chat via `scheduleAgentWakeup` (optional `originChatId` on run, same re-entry as background subagents), gate approval UI wiring (`onGateOpened` → durable approval protocol → panel/chat card), AgentCoordinator + server.ts wiring (incl. `recoverOnStartup` call at boot), env vars (`KANNA_ORCH_MAX_PARALLEL_TASKS`, `KANNA_ORCH_WORKTREE_POOL_SIZE`). Out of scope (Plan C): WS `orchestration` topic (list snapshot push + `orchestration.getRun` timeline RPC), zustand store, panel UI (gate approve/reject buttons, run/task cancel button, per-worktree "Open PR" button (F14), per-worker transcript drill-in via existing subagent viewer, scope-overlap warning badge, verify-attempt timeline with `outputExcerpt`, run result summary card), launch transcript card, UI run-creation form (fields: title, tasks + scopePaths, phases editor incl. per-phase model, gates, contextPrompt, verify command, init command, pool size, worker count).
