import path from "node:path"

import { LOOP_SECTIONS } from "../../shared/loop-progress"
import {
  bindRun,
  claimNextTask,
  markIntegrated,
  readTaskQueue,
  releaseLeasesOfDeadRuns,
  settleTask,
  type QueueProblem,
  type TaskQueueContext,
} from "../../shared/loop-task-queue"
import { resolveStructuredDoc } from "../../shared/structured-doc/registry"
import type { StructuredDoc } from "../../shared/structured-doc/types"

export const CLAIM_TRACKING_TASK_DESCRIPTION =
  "Atomically lease ONE task from the tracking file's Task queue so no two workers ever get the same task. Returns the task's id, text, worktree, branch and a claim_id — pass that claim_id to delegate_subagent so the lease is bound to the worker's run and can be recovered if it dies. A task is claimable only when it is unclaimed, every id in its `needs:` is done, and its worktree is not held by a live worker. When nothing is claimable the result says which: WAIT (a live worker still holds what the rest depend on — end your turn, it will wake you) or QUEUE BLOCKED (a cycle, an unknown dependency, or a task with no worktree — stop and let a human repair the plan)."

export const COMPLETE_TRACKING_TASK_DESCRIPTION =
  "Settle a task you claimed. outcome 'done' marks it finished; outcome 'release' returns it to the queue so a later iteration retries it instead of the work being lost. Always call this before terminating — a lease you never settle is only recovered once Kanna notices your run has ended."

export interface TaskQueueToolDeps {
  chatId: string
  baseDir: () => string
  readDoc: (absPath: string) => Promise<string | null>
  writeDoc: (absPath: string, content: string) => Promise<void>
  withFileLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>
  isRunAlive: (chatId: string, runId: string) => boolean
  confinePath: (
    input: string,
    dir: string,
    label: string,
  ) => { abs: string; rel: string } | { error: string }
  now?: () => number
  newClaimId?: () => string
}

export interface ResolvedQueueFile {
  abs: string
  rel: string
  content: string
  doc: StructuredDoc
}

export type QueueFileResolution = ResolvedQueueFile | { error: string }

export async function resolveQueueFile(
  deps: TaskQueueToolDeps,
  file: string | undefined,
): Promise<QueueFileResolution> {
  const confined = deps.confinePath(file ?? "PROGRESS.md", deps.baseDir(), "file")
  if ("error" in confined) return { error: confined.error }
  const doc = resolveStructuredDoc(path.extname(confined.abs))
  if (!doc) return { error: `the task queue supports .md files only (got ${confined.rel})` }
  const content = await deps.readDoc(confined.abs)
  if (content === null) return { error: `file not found: ${confined.rel}` }
  return { abs: confined.abs, rel: confined.rel, content, doc }
}

export function queueContext(
  deps: TaskQueueToolDeps,
  resolved: ResolvedQueueFile,
  content: string,
): TaskQueueContext {
  return {
    content,
    doc: resolved.doc,
    section: LOOP_SECTIONS.taskQueue,
    now: (deps.now ?? Date.now)(),
    isRunAlive: (runId: string) => deps.isRunAlive(deps.chatId, runId),
  }
}

export function describeProblems(problems: readonly QueueProblem[]): string {
  if (problems.length === 0) return "no claimable task and no live worker"
  return problems
    .map((p) => {
      if (p.kind === "cycle") return `dependency cycle between ${p.ids.join(" → ")}`
      if (p.kind === "unknown_dependency") return `task ${p.id} needs "${p.needs}", which is not in the queue`
      if (p.kind === "duplicate_id") return `duplicate task id ${p.id}`
      return `task ${p.id} names no worktree, so it cannot be run safely alongside others`
    })
    .join("; ")
}

function worktreeEscapesLoop(worktree: string, baseDir: string): boolean {
  const resolved = path.resolve(baseDir, worktree)
  return resolved === path.resolve(baseDir)
}

export interface ClaimResult {
  text: string
  isError: boolean
}

export async function claimTrackingTask(
  deps: TaskQueueToolDeps,
  input: { file?: string },
): Promise<ClaimResult> {
  const resolved = await resolveQueueFile(deps, input.file)
  if ("error" in resolved) return { text: resolved.error, isError: true }

  return deps.withFileLock(resolved.abs, async () => {
    const fresh = (await deps.readDoc(resolved.abs)) ?? resolved.content
    const reclaimed = releaseLeasesOfDeadRuns(queueContext(deps, resolved, fresh))
    const claimId = (deps.newClaimId ?? (() => crypto.randomUUID().slice(0, 8)))()
    const outcome = claimNextTask(queueContext(deps, resolved, reclaimed.content), { claimId })

    if (outcome.kind === "claimed") {
      const { task } = outcome
      if (task.worktree !== null && worktreeEscapesLoop(task.worktree, deps.baseDir())) {
        return {
          text:
            `QUEUE BLOCKED: task ${task.id} names the loop's own work directory as its worktree.`
            + " Give it a separate git worktree — a worker there would collide with the"
            + " orchestrator's integration merges.",
          isError: true,
        }
      }
      await deps.writeDoc(resolved.abs, outcome.content)
      const note = reclaimed.released.length > 0
        ? ` (reclaimed ${reclaimed.released.join(", ")} from a worker that is no longer running)`
        : ""
      return {
        text: JSON.stringify({
          status: "claimed",
          claim_id: claimId,
          task_id: task.id,
          task: task.text,
          worktree: task.worktree,
          branch: task.branch,
          note: note.trim() || undefined,
        }),
        isError: false,
      }
    }

    if (reclaimed.released.length > 0) await deps.writeDoc(resolved.abs, reclaimed.content)

    if (outcome.kind === "waiting") {
      return {
        text: JSON.stringify({
          status: "WAIT",
          waiting_on: outcome.leased.map((t) => t.id),
          detail:
            "every remaining task depends on work a live worker still holds."
            + " End your turn without delegating; the worker that finishes will wake you.",
        }),
        isError: false,
      }
    }

    if (outcome.kind === "exhausted") {
      return { text: JSON.stringify({ status: "exhausted" }), isError: false }
    }

    return {
      text: JSON.stringify({
        status: "QUEUE BLOCKED",
        blocked: outcome.blockedIds,
        detail: describeProblems(outcome.problems),
      }),
      isError: false,
    }
  })
}

export async function completeTrackingTask(
  deps: TaskQueueToolDeps,
  input: { file?: string; claim_id: string; outcome: "done" | "release" },
): Promise<ClaimResult> {
  const resolved = await resolveQueueFile(deps, input.file)
  if ("error" in resolved) return { text: resolved.error, isError: true }

  return deps.withFileLock(resolved.abs, async () => {
    const fresh = (await deps.readDoc(resolved.abs)) ?? resolved.content
    const settled = settleTask(queueContext(deps, resolved, fresh), {
      claimId: input.claim_id,
      outcome: input.outcome,
    })
    if (settled.kind === "not_found") {
      return {
        text:
          `no task in ${resolved.rel} holds claim ${input.claim_id}.`
          + " It may already have been settled, or reclaimed because this run stopped reporting.",
        isError: true,
      }
    }
    await deps.writeDoc(resolved.abs, settled.content)
    const verb = input.outcome === "done" ? "marked done" : "released back to the queue"
    return { text: `Task ${settled.task.id} ${verb} in ${resolved.rel}.`, isError: false }
  })
}

export async function bindClaimToRun(
  deps: TaskQueueToolDeps,
  args: { file?: string; claimId: string; runId: string },
): Promise<void> {
  const resolved = await resolveQueueFile(deps, args.file)
  if ("error" in resolved) return
  await deps.withFileLock(resolved.abs, async () => {
    const fresh = (await deps.readDoc(resolved.abs)) ?? resolved.content
    const bound = bindRun(queueContext(deps, resolved, fresh), {
      claimId: args.claimId,
      runId: args.runId,
    })
    if (bound.kind === "ok") await deps.writeDoc(resolved.abs, bound.content)
  })
}

export const INTEGRATE_TRACKING_TASKS_DESCRIPTION =
  "Merge every finished task branch that is not yet integrated into the loop's integration branch, so the next worker's worktree can see the work its task depends on. Call this FIRST every turn, before claiming. Returns what it merged and what conflicted; a conflict between sibling tasks is a plan defect, so stop the loop and let a human repair it rather than resolving it blind."

export type MergeBranchFn = (
  workdir: string,
  branch: string,
) => Promise<{ ok: boolean; conflicts: readonly string[]; detail: string }>

export async function integrateTrackingTasks(
  deps: TaskQueueToolDeps,
  mergeBranch: MergeBranchFn,
  input: { file?: string },
): Promise<ClaimResult> {
  const resolved = await resolveQueueFile(deps, input.file)
  if ("error" in resolved) return { text: resolved.error, isError: true }

  const workdir = deps.baseDir()
  const pending = readTaskQueue(queueContext(deps, resolved, resolved.content)).filter(
    (t) => t.state === "done" && !t.integrated && t.branch !== null,
  )
  if (pending.length === 0) {
    return { text: JSON.stringify({ status: "nothing_to_integrate" }), isError: false }
  }

  const merged: string[] = []
  const conflicted: { task: string; branch: string; detail: string }[] = []
  for (const task of pending) {
    const branch = task.branch
    if (branch === null) continue
    const outcome = await mergeBranch(workdir, branch)
    if (!outcome.ok) {
      conflicted.push({ task: task.id, branch, detail: outcome.detail })
      break
    }
    merged.push(task.id)
    await deps.withFileLock(resolved.abs, async () => {
      const fresh = (await deps.readDoc(resolved.abs)) ?? resolved.content
      const marked = markIntegrated(queueContext(deps, resolved, fresh), { taskId: task.id })
      if (marked.kind === "ok") await deps.writeDoc(resolved.abs, marked.content)
    })
  }

  return {
    text: JSON.stringify({
      status: conflicted.length > 0 ? "QUEUE BLOCKED" : "integrated",
      integrated: merged,
      ...(conflicted.length > 0 ? { conflict: conflicted[0] } : {}),
    }),
    isError: false,
  }
}

export async function queueSnapshot(
  deps: TaskQueueToolDeps,
  file: string | undefined,
): Promise<ReturnType<typeof readTaskQueue> | null> {
  const resolved = await resolveQueueFile(deps, file)
  if ("error" in resolved) return null
  return readTaskQueue(queueContext(deps, resolved, resolved.content))
}
