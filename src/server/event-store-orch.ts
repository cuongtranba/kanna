/**
 * Orchestration read-model layer — pure functions that fold OrchestrationEvents
 * into the `orchRunsById` map and project snapshots from it.
 *
 * Extracted from event-store.ts; EventStore delegates every orch* method here.
 * All functions are pure with respect to IO: they mutate only the map they
 * receive, which is the same Map instance held in StoreState.
 */

import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import type { OrchRunSnapshot, OrchTaskSnapshot } from "../shared/orchestration-types"
import type { OrchestrationEvent, OrchRunRecord, OrchTaskRecord } from "./events"
import { isTaskEventType, nextRunStatus, nextTaskState } from "./orchestration-state-machine"

// ---------------------------------------------------------------------------
// Event application
// ---------------------------------------------------------------------------

/**
 * Fold one OrchestrationEvent into the orchRunsById map in place.
 * Mirrors the private `applyOrchestrationEvent` that lived in EventStore.
 */
export function applyOrchEvent(
  orchRunsById: Map<string, OrchRunRecord>,
  event: OrchestrationEvent,
): void {
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
        verifying: false,
        updatedAt: event.timestamp,
      })
    }
    orchRunsById.set(event.runId, {
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

  const run = orchRunsById.get(event.runId)
  if (!run) return

  run.eventLog.push(event)
  run.updatedAt = event.timestamp

  if (event.type === "orch_run_completed" || event.type === "orch_run_cancelled") {
    const trans = nextRunStatus(run.status, event.type)
    if (!trans.ok) {
      log.warn(`${LOG_PREFIX} dropped illegal orch run transition`, {
        runId: event.runId,
        from: run.status,
        event: event.type,
      })
      return
    }
    run.status = trans.next
    return
  }

  if (event.type === "orch_scope_overlap_flagged") return // observability-only, no state fold
  if (event.type === "orch_config_warning") return // observability-only, no state fold

  // Worktree pool fold (F13)
  if (event.type === "orch_worktree_provisioned") {
    run.worktrees.push({
      index: event.index,
      path: event.path,
      branch: event.branch,
      heldByTaskId: null,
      initialized: false,
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

  // FSM guard: drop an illegal task transition rather than corrupt the read
  // model. The engine only emits legal transitions, so this is a defensive
  // invariant (also protects replay of an older/foreign log).
  if (isTaskEventType(event.type)) {
    const trans = nextTaskState(task.state, event.type)
    if (!trans.ok) {
      log.warn(`${LOG_PREFIX} dropped illegal orch task transition`, {
        runId: event.runId,
        taskId: event.taskId,
        from: task.state,
        event: event.type,
      })
      return
    }
  }

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
      task.verifying = false
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
      task.verifying = true // observable stage; task stays "running"
      break
    case "orch_verify_completed":
      task.verifying = false
      break
    case "orch_task_committed":
      task.state = "committed"
      task.ownerWorkerId = null
      task.commitSha = event.commitSha
      task.verifying = false
      {
        const slot = slotOf(task)
        if (slot?.heldByTaskId === task.taskId) slot.heldByTaskId = null
      }
      break
    case "orch_task_failed":
      task.state = "failed"
      task.ownerWorkerId = null
      task.error = event.error
      task.verifying = false
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
      task.verifying = false
      break
  }
}

// ---------------------------------------------------------------------------
// Snapshot projection
// ---------------------------------------------------------------------------

/** Project a stored OrchRunRecord into the wire-safe OrchRunSnapshot shape. */
export function toOrchRunSnapshot(run: OrchRunRecord): OrchRunSnapshot {
  const tasks: OrchTaskSnapshot[] = run.taskOrder.flatMap((taskId) => {
    const t = run.tasksById.get(taskId)
    if (!t) return []
    return [
      {
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
        verifying: t.verifying,
        updatedAt: t.updatedAt,
      },
    ]
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

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Look up one run by id and project it to a snapshot. */
export function getOrchRunSnapshot(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
): OrchRunSnapshot | null {
  const run = orchRunsById.get(runId)
  if (!run) return null
  return toOrchRunSnapshot(run)
}

/** Project all runs to snapshots. */
export function getAllOrchRunSnapshots(
  orchRunsById: Map<string, OrchRunRecord>,
): OrchRunSnapshot[] {
  return [...orchRunsById.values()].map(toOrchRunSnapshot)
}

/** Task spec lookup for the engine (records keep prompt/scope; snapshots do not). */
export function getOrchTaskSpec(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
  taskId: string,
): { prompt: string; scopePaths: string[] } | null {
  const task = orchRunsById.get(runId)?.tasksById.get(taskId)
  if (!task) return null
  return { prompt: task.prompt, scopePaths: task.scopePaths }
}

/** Last completed phase's output — {{PRIOR}} context when resuming a gated/recovered task. */
export function getOrchLastPhaseOutput(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
  taskId: string,
): string | null {
  return orchRunsById.get(runId)?.tasksById.get(taskId)?.lastPhaseOutput ?? null
}

/** Full ordered event timeline for one run — the rich drill-in source (F8). */
export function getOrchRunEvents(
  orchRunsById: Map<string, OrchRunRecord>,
  runId: string,
): OrchestrationEvent[] {
  return [...(orchRunsById.get(runId)?.eventLog ?? [])]
}

// ---------------------------------------------------------------------------
// Recovery iterators
// ---------------------------------------------------------------------------

/**
 * Tasks a restart must RE-QUEUE.
 * `gated` is deliberately excluded — a gated task is re-armed in place
 * (gate re-notified), never requeued.
 */
export function* nonTerminalOrchTasks(
  orchRunsById: Map<string, OrchRunRecord>,
): Generator<{ runId: string; taskId: string; state: "claimed" | "running" }> {
  for (const run of orchRunsById.values()) {
    if (run.status !== "running") continue
    for (const task of run.tasksById.values()) {
      if (task.state === "claimed" || task.state === "running") {
        yield { runId: run.runId, taskId: task.taskId, state: task.state }
      }
    }
  }
}

/** Tasks paused at a hard gate — re-armed (not requeued) by recoverOnStartup. */
export function* gatedOrchTasks(
  orchRunsById: Map<string, OrchRunRecord>,
): Generator<{ runId: string; taskId: string; phaseIndex: number }> {
  for (const run of orchRunsById.values()) {
    if (run.status !== "running") continue
    for (const task of run.tasksById.values()) {
      if (task.state === "gated") {
        yield { runId: run.runId, taskId: task.taskId, phaseIndex: task.phaseIndex }
      }
    }
  }
}
