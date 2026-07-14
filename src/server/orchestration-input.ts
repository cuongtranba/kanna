/**
 * Orchestration run input validator + output DTO normalizers (pure).
 *
 * ONE funnel every entry point (MCP tool, WS command, chat trigger) passes
 * through before the engine sees anything — mirrors `loop-template.ts`
 * `validateLoopSetup`. Transport-layer zod catches shape errors; this enforces
 * the domain rules and returns a fully-resolved, fixed `OrchRunConfig` so the
 * "simple, linear, no-branching" contract can never drift. NO IO, no `any`.
 */

import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_ORCH_PHASES,
  DEFAULT_VERIFY_RETRIES,
  DEFAULT_VERIFY_TIMEOUT_MS,
  type OrchRunConfig,
  type OrchRunDetail,
  type OrchRunInput,
  type OrchRunSnapshot,
  type OrchRunSummary,
  type OrchTaskCounts,
  type OrchTaskSpec,
  type OrchTaskView,
} from "../shared/orchestration-types"
import { shellCommandIsParseable } from "./input-validation"
import { projectStage } from "./orchestration-state-machine"

export const MAX_TASKS = 8
export const MAX_TASK_LEN = 10_000
export const MAX_VERIFY_LEN = 500
/** Effective parallelism / worktree-pool cap for the simple flow. */
export const ORCH_PARALLEL_CAP = 4

export interface OrchRunContext {
  /** Chat that triggered the run — persisted for worker project/OAuth resolution. */
  chatId: string
  /** Absolute repo root the run operates on (the chat cwd). */
  repoRoot: string
  /** Configured subagent roster (id → display name). */
  roster: readonly { id: string; name: string }[]
  /** Configured default worker subagent, used when input omits `subagentId`. */
  defaultOrchSubagentId: string | null
}

export interface ResolvedOrchRun {
  config: OrchRunConfig
  tasks: OrchTaskSpec[]
  subagentId: string
  verifyEnabled: boolean
}

export type OrchRunValidation =
  | { ok: true; resolved: ResolvedOrchRun }
  | { ok: false; errors: string[] }

function isNonBlankString(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0
}

/** First non-empty line, trimmed and capped — the human-facing task title. */
function deriveTitle(task: string): string {
  const firstLine = task.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? task.trim()
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine
}

/**
 * Validate a user-callable run and resolve the FIXED config + tasks. Flat error
 * list (does not fail-fast). On success the returned config is the only shape
 * the engine ever runs for v1: `DEFAULT_ORCH_PHASES`, no gates, pool capped.
 */
export function validateOrchRun(input: OrchRunInput, context: OrchRunContext): OrchRunValidation {
  const errors: string[] = []

  const rawTasks = Array.isArray(input.tasks) ? input.tasks : []
  if (rawTasks.length === 0) {
    errors.push("tasks is required and must be a non-empty array")
  } else if (rawTasks.length > MAX_TASKS) {
    errors.push(`too many tasks: ${rawTasks.length} (max ${MAX_TASKS})`)
  }
  rawTasks.forEach((task, i) => {
    if (!isNonBlankString(task)) {
      errors.push(`task ${i + 1} is blank`)
    } else if (task.length > MAX_TASK_LEN) {
      errors.push(`task ${i + 1} exceeds max length ${MAX_TASK_LEN}`)
    }
  })

  let verifyEnabled = false
  if (input.verify !== undefined) {
    if (typeof input.verify !== "string") {
      errors.push("verify must be a string when provided")
    } else if (input.verify.trim() !== "") {
      if (input.verify.length > MAX_VERIFY_LEN) {
        errors.push(`verify exceeds max length ${MAX_VERIFY_LEN}`)
      } else if (!shellCommandIsParseable(input.verify)) {
        errors.push("verify is not a parseable shell command (unmatched quotes / empty)")
      } else {
        verifyEnabled = true
      }
    }
  }

  const requestedSubagentId = isNonBlankString(input.subagentId)
    ? input.subagentId.trim()
    : (context.defaultOrchSubagentId ?? null)
  if (!requestedSubagentId) {
    errors.push("subagentId is required: pass it explicitly or set a default orchestration subagent in Settings")
  } else if (!context.roster.some((s) => s.id === requestedSubagentId)) {
    errors.push(`subagentId "${requestedSubagentId}" is not a known subagent`)
  }

  if (errors.length > 0) return { ok: false, errors }
  if (requestedSubagentId === null) return { ok: false, errors: ["internal: subagentId unresolved"] }
  const subagentId = requestedSubagentId

  const tasks: OrchTaskSpec[] = rawTasks.map((task, i) => ({
    id: `t${i + 1}`,
    title: deriveTitle(task),
    prompt: task.trim(),
  }))

  const parallelism = Math.min(tasks.length, ORCH_PARALLEL_CAP)
  const config: OrchRunConfig = {
    title: `Run: ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
    repoRoot: context.repoRoot,
    baseBranch: "main",
    maxParallelTasks: parallelism,
    worktreePoolSize: parallelism,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    phases: DEFAULT_ORCH_PHASES,
    gates: [],
    contextPrompt: null,
    verify: verifyEnabled
      ? { command: ["sh", "-c", input.verify!.trim()], timeoutMs: DEFAULT_VERIFY_TIMEOUT_MS, retries: DEFAULT_VERIFY_RETRIES }
      : null,
    init: null,
    workerSubagentId: subagentId,
    originChatId: context.chatId,
  }

  // Structural post-check: the fixed-shape invariants can never silently drift.
  const structuralErrors: string[] = []
  if (config.gates.length !== 0) structuralErrors.push("gates must be empty in v1")
  if (config.phases !== DEFAULT_ORCH_PHASES) structuralErrors.push("phases must be the default pipeline")
  if (config.worktreePoolSize > ORCH_PARALLEL_CAP) structuralErrors.push("worktree pool exceeds cap")
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors.map((e) => `internal: ${e}`) }
  }

  return { ok: true, resolved: { config, tasks, subagentId, verifyEnabled } }
}

// ---------------------------------------------------------------------------
// Output DTO normalizers — the SINGLE shape agent (orch_run_status) + UI
// (topic push, orch.getRun) both read.
// ---------------------------------------------------------------------------

function countTasks(snapshot: OrchRunSnapshot): OrchTaskCounts {
  const counts: OrchTaskCounts = { total: 0, queued: 0, running: 0, committed: 0, failed: 0 }
  for (const t of snapshot.tasks) {
    counts.total += 1
    if (t.state === "committed") counts.committed += 1
    else if (t.state === "failed") counts.failed += 1
    else if (t.state === "queued" || t.state === "claimed") counts.queued += 1
    else counts.running += 1 // running | gated
  }
  return counts
}

export function toOrchRunSummary(snapshot: OrchRunSnapshot): OrchRunSummary {
  return {
    runId: snapshot.runId,
    title: snapshot.config.title,
    status: snapshot.status,
    counts: countTasks(snapshot),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  }
}

export function toOrchRunDetail(snapshot: OrchRunSnapshot): OrchRunDetail {
  const phaseKinds = snapshot.config.phases.map((p) => p.kind)
  const tasks: OrchTaskView[] = snapshot.tasks.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    state: t.state,
    stage: projectStage(t.state, t.phaseIndex, phaseKinds, t.verifying),
    phaseIndex: t.phaseIndex,
    attempts: t.attempts,
    error: t.error,
    commitSha: t.commitSha,
    updatedAt: t.updatedAt,
  }))
  return { ...toOrchRunSummary(snapshot), tasks, verifyEnabled: snapshot.config.verify !== null }
}
