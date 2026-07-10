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
  ensureWorktree(repoRoot: string, branch: string, wtPath: string, base: string): Promise<{ path: string; branch: string; headSha: string }>
  removeWorktree(repoRoot: string, wtPath: string): Promise<void>
  commitAll(wtPath: string, message: string): Promise<{ kind: "committed"; sha: string } | { kind: "noChanges" }>
  diffAgainstBase(wtPath: string, baseRef: string): Promise<string>
  resetHard(wtPath: string): Promise<void>
}

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
  runVerify?: (wtPath: string, command: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>
  runInit?: (wtPath: string, command: string[], timeoutMs: number) => Promise<{ exitCode: number; output: string }>
  onGateOpened?: (notice: OrchGateOpenedNotice) => void
  now?: () => number
  worktreeDir?: string
}

interface TaskRuntime {
  abortController: AbortController
}

interface RunRuntime {
  cancelled: boolean
  permits: number
  taskRuntimes: Map<string, TaskRuntime>
  gateResolvers: Map<string, (decision: OrchGateDecision) => void>
  slotHeads: Map<string, string>
  poolReady: boolean
  done: { promise: Promise<void>; resolve: () => void }
  scheduling: boolean
}

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
      await this.deps.store.appendOrchestrationEvent({
        v: 3, type: "orch_scope_overlap_flagged", timestamp: this.now(), runId,
        taskIds: overlap.taskIds, paths: overlap.paths,
      })
    }
    if (config.maxParallelTasks > config.worktreePoolSize) {
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
        await this.deps.store.appendOrchestrationEvent({
          v: 3, type: "orch_worktree_init_completed", timestamp: this.now(), runId,
          index: i, ok: true, outputExcerpt: "",
        })
      }
    }
  }

  /**
   * Explicit cancel (AG1). Aborts every in-flight worker, unblocks any task
   * parked at a hard gate (resolvers fire "reject" but `awaitGate` short-circuits
   * on `rt.cancelled` so no reject/failed events are appended), records the
   * terminal `orch_run_cancelled` event, and resolves the run's done promise.
   */
  async cancelRun(runId: string): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return
    rt.cancelled = true
    for (const taskRt of rt.taskRuntimes.values()) taskRt.abortController.abort()
    for (const [taskId, resolver] of [...rt.gateResolvers]) {
      rt.gateResolvers.delete(taskId)
      resolver("reject")
    }
    await this.deps.store.appendOrchestrationEvent({
      v: 3, type: "orch_run_cancelled", timestamp: this.now(), runId,
    })
    rt.done.resolve()
  }

  /**
   * Re-arm tasks parked at a hard gate across a process restart (F2+F5). A gated
   * task is NOT requeued — its worktree still holds the completed phase's work.
   * We rebuild a RunRuntime, seed the slot head from the persisted claim, and
   * re-enter `runTask` with a `GatedResume` that re-notifies the gate at the
   * correct phase and resumes the NEXT phase with the persisted `{{PRIOR}}`.
   */
  async recoverOnStartup(): Promise<void> {
    for (const { runId, taskId, phaseIndex } of this.deps.store.gatedOrchTasks()) {
      const run = this.deps.store.getOrchRun(runId)
      if (!run) continue
      const config = run.config
      const task = run.tasks.find((t) => t.taskId === taskId)
      if (!task || task.worktreePath === null) continue
      const phase = config.phases[phaseIndex]
      if (!phase) continue
      const gate = config.gates.find((g) => g.afterPhase === phase.name)
      if (!gate) continue
      const rt = this.ensureRunRuntime(runId, config)
      rt.poolReady = true
      rt.slotHeads.set(task.worktreePath, task.baseSha ?? "")
      const resume: GatedResume = {
        fromPhase: phaseIndex + 1,
        prior: this.deps.store.getOrchLastPhaseOutput(runId, taskId) ?? "",
        pendingGate: { phaseIndex, phaseName: phase.name, kind: gate.kind },
      }
      const workerId = `w-${taskId}-resume`
      void this.runTask(runId, taskId, workerId, task.worktreePath, task.branch ?? "", task.baseSha ?? "", resume)
    }
  }

  resolveGate(runId: string, taskId: string, decision: OrchGateDecision): boolean {
    const rt = this.runRuntimes.get(runId)
    const resolver = rt?.gateResolvers.get(taskId)
    if (!rt || !resolver) return false
    rt.gateResolvers.delete(taskId)
    resolver(decision)
    return true
  }

  waitForRun(runId: string): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return Promise.resolve()
    return rt.done.promise
  }

  /** Current permit count for a run (test/introspection). 0 if unknown. */
  getPermits(runId: string): number {
    return this.runRuntimes.get(runId)?.permits ?? 0
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

  private schedule(runId: string): void {
    const rt = this.runRuntimes.get(runId)
    if (!rt || rt.cancelled || rt.scheduling || !rt.poolReady) return
    rt.scheduling = true
    try {
      const run = this.deps.store.getOrchRun(runId)
      if (!run || run.status !== "running") { this.finishIfTerminal(runId); return }
      const usable = run.worktrees.filter((w) => w.initialized)
      if (usable.length === 0) {
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
        const slot = task.worktreePath !== null
          ? run.worktrees.find((w) => w.path === task.worktreePath)
          : usable.find((w) => w.heldByTaskId === null && !takenThisTurn.has(w.path))
        if (!slot) continue
        if (task.worktreePath === null && takenThisTurn.has(slot.path)) continue
        takenThisTurn.add(slot.path)
        rt.permits -= 1
        const workerId = `w-${task.taskId}-a${task.attempts + 1}`
        const baseSha = rt.slotHeads.get(slot.path) ?? ""
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

  private async runTask(runId: string, taskId: string, workerId: string, wtPath: string, branch: string, baseSha: string, resume?: GatedResume): Promise<void> {
    const rt = this.runRuntimes.get(runId)
    if (!rt) return
    const taskRt: TaskRuntime = { abortController: new AbortController() }
    rt.taskRuntimes.set(taskId, taskRt)
    let terminalFailed = false
    // Idle gate holds no permit. The normal schedule() path decrements a permit
    // before calling runTask, so it enters already holding one. A recovered
    // gated task (resume) enters holding NONE — it re-parks at its gate and only
    // acquires a permit once the gate is approved. `heldPermit` guards the
    // finally release so a recovered task can never inflate the pool (approve →
    // acquire then release = balanced; reject → never acquired, never released).
    let heldPermit = resume === undefined
    try {
      const run = this.deps.store.getOrchRun(runId)
      if (!run) return
      const config = run.config
      if (resume) {
        const proceed = await this.awaitGate(rt, runId, taskId, resume.pendingGate.phaseIndex, resume.pendingGate.phaseName, resume.pendingGate.kind)
        if (!proceed) return
        rt.permits -= 1
        heldPermit = true
      }
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
      if (config.verify && this.deps.runVerify) {
        const passed = await this.runVerifyLoop(rt, runId, taskId, workerId, wtPath, baseSha, config, taskSpec)
        if (!passed) {
          if (!rt.cancelled) terminalFailed = true
          return
        }
      }
      const commit = await this.deps.worktrees.commitAll(wtPath, `orch(${config.title}): ${taskId}`)
      if (commit.kind === "committed") {
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
        try { await this.deps.worktrees.resetHard(wtPath) } catch { /* logged by adapter */ }
      }
      rt.taskRuntimes.delete(taskId)
      rt.gateResolvers.delete(taskId)
      if (heldPermit) rt.permits += 1
      this.schedule(runId)
    }
  }

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
    baseRef: string,
    contextPrompt: string | null,
    scopePaths: string[],
  ): Promise<string> {
    let prompt = phase.promptTemplate
      .replaceAll("{{TASK}}", taskPrompt)
      .replaceAll("{{PRIOR}}", prior)
    if (prompt.includes("{{DIFF}}")) {
      const diff = await this.deps.worktrees.diffAgainstBase(wtPath, baseRef)
      prompt = prompt.replaceAll("{{DIFF}}", diff)
    }
    if (contextPrompt) {
      prompt = `${contextPrompt}\n\n---\n\n${prompt}`
    }
    if (phase.kind === "implement" && scopePaths.length > 0) {
      prompt = `${prompt}\n\nScope (files/dirs you own for this task): ${scopePaths.join(", ")}`
    }
    return prompt
  }

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
      if (fixPhaseIndex === -1) break
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
