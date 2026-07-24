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
  /**
   * Subagent id the host `StartWorker` spawns for every phase (user-callable
   * wiring). Persisted in `orch_run_created` so the worker resolution survives
   * restart. Absent = host falls back to its configured default worker.
   */
  workerSubagentId?: string
  /**
   * Chat that triggered this run (user-callable wiring). Persisted so the host
   * worker resolves the originating project + OAuth after a restart. Absent for
   * engine-only test runs.
   */
  originChatId?: string
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
  /** True while a verify step is in flight (folded from verify_started/completed). */
  verifying: boolean
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

// ---------------------------------------------------------------------------
// User-callable wiring: input contract + canonical output DTOs
// ---------------------------------------------------------------------------

/**
 * The entire trigger surface for a user-callable run. A list of task prompts
 * plus an optional verify command — everything else is a fixed server default
 * (see `validateOrchRun`). No pipeline / worktree / gate knobs by design.
 */
export interface OrchRunInput {
  tasks: string[]
  verify?: string
  subagentId?: string
}

/** The linear stage a task chip renders — a pure projection off FSM state. */
export type OrchStage =
  | "queued"
  | "implement"
  | "review"
  | "fix"
  | "verify"
  | "committed"
  | "failed"

/** Per-status task tallies for a run summary. */
export interface OrchTaskCounts {
  total: number
  queued: number
  running: number
  committed: number
  failed: number
}

/** Lightweight run row for the list view + WS topic push. */
export interface OrchRunSummary {
  runId: string
  title: string
  status: OrchRunStatus
  counts: OrchTaskCounts
  createdAt: number
  updatedAt: number
}

/** Per-task view carried in the run detail — FSM state + derived linear stage. */
export interface OrchTaskView {
  taskId: string
  title: string
  state: OrchTaskState
  stage: OrchStage
  phaseIndex: number
  attempts: number
  error: string | null
  commitSha: string | null
  updatedAt: number
}

/** Full drill-in payload for one run — the single shape agent + UI both read. */
export interface OrchRunDetail extends OrchRunSummary {
  tasks: OrchTaskView[]
  verifyEnabled: boolean
}

export type OrchReviewSeverity = "critical" | "major" | "minor"

/**
 * One structured finding from an adversarial-review worker. Reviewers are
 * prompted to emit a fenced JSON array of these; the engine parses tolerantly
 * (`parseReviewFindings`) and falls back to the raw reviewer text when the
 * output does not conform — a malformed reply never fails the run.
 */
export interface OrchReviewFinding {
  file: string
  line: number | null
  problem: string
  suggestedFix: string | null
  severity: OrchReviewSeverity | null
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
      'You are an adversarial reviewer. You see ONLY this diff. Find real bugs — logic errors, edge cases, broken invariants. If there are none, reply exactly NO_FINDINGS. Otherwise reply with ONLY a fenced ```json code block containing an array of findings, each shaped {"file": string, "line": number|null, "problem": string, "suggestedFix": string|null, "severity": "critical"|"major"|"minor"}.\n\nDiff:\n{{DIFF}}',
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
