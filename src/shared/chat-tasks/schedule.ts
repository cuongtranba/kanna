import { isNativeTaskId, type ChatTaskRecord } from "./types"

export const CHAT_TASK_CLAIM_GRACE_MS = 120_000

export interface ChatTaskScheduleContext {
  readonly now: number
  readonly claimGraceMs?: number
  readonly isRunAlive?: (runId: string) => boolean
}

export type ChatTaskProblem =
  | { kind: "duplicate_id"; id: string }
  | { kind: "unknown_dependency"; id: string; needs: string }
  | { kind: "missing_worktree"; id: string }
  | { kind: "cycle"; ids: readonly string[] }

export type ChatTaskClaimOutcome =
  | { kind: "claimable"; task: ChatTaskRecord }
  | { kind: "waiting"; leased: readonly ChatTaskRecord[] }
  | { kind: "blocked"; problems: readonly ChatTaskProblem[]; blockedIds: readonly string[] }
  | { kind: "exhausted" }

export function leaseIsStale(
  task: ChatTaskRecord,
  ctx: ChatTaskScheduleContext,
): boolean {
  if (task.status !== "in_progress") return false
  if (task.runId !== null) {
    return ctx.isRunAlive === undefined ? false : !ctx.isRunAlive(task.runId)
  }
  const grace = ctx.claimGraceMs ?? CHAT_TASK_CLAIM_GRACE_MS
  return task.claimedAt === null || ctx.now - task.claimedAt > grace
}

function detectCycles(
  tasks: readonly ChatTaskRecord[],
  byId: ReadonlyMap<string, ChatTaskRecord>,
): ChatTaskProblem[] {
  const problems: ChatTaskProblem[] = []
  const reported = new Set<string>()
  const visiting = new Set<string>()
  const done = new Set<string>()
  const stack: string[] = []

  const visit = (id: string): void => {
    if (done.has(id)) return
    if (visiting.has(id)) {
      const from = stack.indexOf(id)
      const ids = stack.slice(from < 0 ? 0 : from)
      const key = [...ids].sort().join(",")
      if (!reported.has(key)) {
        reported.add(key)
        problems.push({ kind: "cycle", ids })
      }
      return
    }
    visiting.add(id)
    stack.push(id)
    for (const need of byId.get(id)?.needs ?? []) {
      if (byId.has(need)) visit(need)
    }
    stack.pop()
    visiting.delete(id)
    done.add(id)
  }

  for (const task of tasks) visit(task.id)
  return problems
}

export function validateChatTasks(
  tasks: readonly ChatTaskRecord[],
  opts: { readonly requireWorktree: boolean },
): readonly ChatTaskProblem[] {
  const problems: ChatTaskProblem[] = []
  const byId = new Map<string, ChatTaskRecord>()
  const duplicates = new Set<string>()

  for (const task of tasks) {
    if (byId.has(task.id)) {
      if (!duplicates.has(task.id)) {
        duplicates.add(task.id)
        problems.push({ kind: "duplicate_id", id: task.id })
      }
      continue
    }
    byId.set(task.id, task)
  }

  for (const task of tasks) {
    for (const need of task.needs) {
      if (!byId.has(need)) problems.push({ kind: "unknown_dependency", id: task.id, needs: need })
    }
    if (opts.requireWorktree && task.status !== "completed" && task.worktree === null) {
      problems.push({ kind: "missing_worktree", id: task.id })
    }
  }

  problems.push(...detectCycles(tasks, byId))
  return problems
}

export function selectClaimableTask(
  tasks: readonly ChatTaskRecord[],
  ctx: ChatTaskScheduleContext,
  opts: { readonly requireWorktree: boolean },
): ChatTaskClaimOutcome {
  const claimable = tasks.filter((task) => !isNativeTaskId(task.id))
  if (claimable.length === 0) return { kind: "exhausted" }

  const doneIds = new Set(claimable.filter((t) => t.status === "completed").map((t) => t.id))
  const liveLeases = claimable.filter(
    (t) => t.status === "in_progress" && !leaseIsStale(t, ctx),
  )
  const heldWorktrees = new Set(
    liveLeases.map((t) => t.worktree).filter((w): w is string => w !== null),
  )

  const next = claimable.find(
    (t) =>
      (t.status === "pending" || (t.status === "in_progress" && leaseIsStale(t, ctx)))
      && (!opts.requireWorktree || t.worktree !== null)
      && (t.worktree === null || !heldWorktrees.has(t.worktree))
      && t.needs.every((need) => doneIds.has(need)),
  )
  if (next) return { kind: "claimable", task: next }

  const unfinished = claimable.filter((t) => t.status !== "completed")
  if (unfinished.length === 0) return { kind: "exhausted" }
  if (liveLeases.length > 0) return { kind: "waiting", leased: liveLeases }
  return {
    kind: "blocked",
    problems: validateChatTasks(claimable, opts),
    blockedIds: unfinished.map((t) => t.id),
  }
}

export function isBlockedByNeeds(
  task: ChatTaskRecord,
  tasks: readonly ChatTaskRecord[],
): boolean {
  if (task.needs.length === 0) return false
  const doneIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id))
  return !task.needs.every((need) => doneIds.has(need))
}
