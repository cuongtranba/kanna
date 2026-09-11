import type { StructuredDoc } from "./structured-doc/types"

export const TASK_QUEUE_SECTION = "Task queue"

export const TASK_QUEUE_CLAIM_GRACE_MS = 120_000

export type TaskState = "available" | "leased" | "done"

export interface QueueTask {
  index: number
  id: string
  text: string
  state: TaskState
  stale: boolean
  needs: readonly string[]
  worktree: string | null
  branch: string | null
  integrated: boolean
  claimId: string | null
  claimedAt: number | null
  runId: string | null
  bullet: string
  continuation: string
}

export interface TaskQueueContext {
  content: string
  doc: StructuredDoc
  section?: string
  now: number
  claimGraceMs?: number
  isRunAlive?: (runId: string) => boolean
}

export type QueueProblem =
  | { kind: "duplicate_id"; id: string }
  | { kind: "unknown_dependency"; id: string; needs: string }
  | { kind: "missing_worktree"; id: string }
  | { kind: "cycle"; ids: readonly string[] }

export type ClaimOutcome =
  | { kind: "claimed"; content: string; task: QueueTask; claimId: string }
  | { kind: "waiting"; leased: readonly QueueTask[] }
  | { kind: "blocked"; problems: readonly QueueProblem[]; blockedIds: readonly string[] }
  | { kind: "exhausted" }

export type TaskWriteOutcome =
  | { kind: "ok"; content: string; task: QueueTask }
  | { kind: "not_found" }

const ITEM_PATTERN = /^(\s*[-*+]\s+)\[([ ~xX])\]\s*(.*)$/

const META_SEPARATOR = " | "

function stateOfMark(mark: string): TaskState {
  if (mark === "x" || mark === "X") return "done"
  return mark === "~" ? "leased" : "available"
}

function markOfState(state: TaskState): string {
  if (state === "done") return "x"
  return state === "leased" ? "~" : " "
}

interface ParsedMeta {
  needs: string[]
  worktree: string | null
  branch: string | null
  integrated: boolean
  claimId: string | null
  claimedAt: number | null
  runId: string | null
}

function parseClaim(value: string): { claimId: string | null; claimedAt: number | null } {
  const at = value.lastIndexOf("@")
  if (at < 0) return { claimId: value.trim() || null, claimedAt: null }
  const claimId = value.slice(0, at).trim()
  const parsed = Date.parse(value.slice(at + 1).trim())
  return {
    claimId: claimId.length > 0 ? claimId : null,
    claimedAt: Number.isNaN(parsed) ? null : parsed,
  }
}

function parseMeta(segments: readonly string[]): ParsedMeta {
  const meta: ParsedMeta = {
    needs: [],
    worktree: null,
    branch: null,
    integrated: false,
    claimId: null,
    claimedAt: null,
    runId: null,
  }

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.length === 0) continue
    if (trimmed.toLowerCase() === "integrated") {
      meta.integrated = true
      continue
    }
    const colon = trimmed.indexOf(":")
    if (colon < 0) continue
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const value = trimmed.slice(colon + 1).trim()
    if (key === "needs") {
      meta.needs = value.split(",").map((n) => n.trim()).filter((n) => n.length > 0)
    } else if (key === "worktree") {
      meta.worktree = value.length > 0 ? value : null
    } else if (key === "branch") {
      meta.branch = value.length > 0 ? value : null
    } else if (key === "run") {
      meta.runId = value.length > 0 ? value : null
    } else if (key === "claim") {
      const claim = parseClaim(value)
      meta.claimId = claim.claimId
      meta.claimedAt = claim.claimedAt
    }
  }

  return meta
}

function leaseIsStale(
  meta: ParsedMeta,
  now: number,
  claimGraceMs: number,
  isRunAlive?: (runId: string) => boolean,
): boolean {
  if (meta.runId !== null) {
    return isRunAlive === undefined ? false : !isRunAlive(meta.runId)
  }
  return meta.claimedAt === null || now - meta.claimedAt > claimGraceMs
}

function parseTask(
  raw: string,
  index: number,
  ctx: TaskQueueContext,
): QueueTask | null {
  const breakAt = raw.indexOf("\n")
  const firstLine = breakAt < 0 ? raw : raw.slice(0, breakAt)
  const continuation = breakAt < 0 ? "" : raw.slice(breakAt)

  const match = ITEM_PATTERN.exec(firstLine)
  if (!match) return null
  const [, bullet = "", mark = " ", body = ""] = match

  const segments = body.split(META_SEPARATOR)
  const head = (segments[0] ?? "").trim()
  const meta = parseMeta(segments.slice(1))

  const space = head.search(/\s/)
  const id = space < 0 ? head : head.slice(0, space)
  const text = space < 0 ? "" : head.slice(space + 1).trim()
  if (id.length === 0) return null

  const state = stateOfMark(mark)
  const stale =
    state === "leased"
    && leaseIsStale(meta, ctx.now, ctx.claimGraceMs ?? TASK_QUEUE_CLAIM_GRACE_MS, ctx.isRunAlive)

  return {
    index,
    id,
    text,
    state,
    stale,
    needs: meta.needs,
    worktree: meta.worktree,
    branch: meta.branch,
    integrated: meta.integrated,
    claimId: meta.claimId,
    claimedAt: meta.claimedAt,
    runId: meta.runId,
    bullet,
    continuation,
  }
}

export function renderTask(task: QueueTask): string {
  const parts: string[] = [[task.id, task.text].filter((p) => p.length > 0).join(" ")]
  if (task.needs.length > 0) parts.push(`needs: ${task.needs.join(", ")}`)
  if (task.worktree !== null) parts.push(`worktree: ${task.worktree}`)
  if (task.branch !== null) parts.push(`branch: ${task.branch}`)
  if (task.claimId !== null) {
    const stamp = task.claimedAt === null ? "" : ` @${new Date(task.claimedAt).toISOString()}`
    parts.push(`claim: ${task.claimId}${stamp}`)
  }
  if (task.runId !== null) parts.push(`run: ${task.runId}`)
  if (task.integrated) parts.push("integrated")
  return `${task.bullet}[${markOfState(task.state)}] ${parts.join(META_SEPARATOR)}${task.continuation}`
}

export function readTaskQueue(ctx: TaskQueueContext): readonly QueueTask[] {
  const tasks: QueueTask[] = []
  ctx.doc.listItems(ctx.content, ctx.section ?? TASK_QUEUE_SECTION).forEach((raw, index) => {
    const task = parseTask(raw, index, ctx)
    if (task !== null) tasks.push(task)
  })
  return tasks
}

function detectCycles(
  tasks: readonly QueueTask[],
  byId: ReadonlyMap<string, QueueTask>,
): QueueProblem[] {
  const problems: QueueProblem[] = []
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

export function validateTaskQueue(tasks: readonly QueueTask[]): readonly QueueProblem[] {
  const problems: QueueProblem[] = []
  const byId = new Map<string, QueueTask>()
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
    if (task.state !== "done" && task.worktree === null) {
      problems.push({ kind: "missing_worktree", id: task.id })
    }
  }

  problems.push(...detectCycles(tasks, byId))
  return problems
}

function writeTask(ctx: TaskQueueContext, task: QueueTask): TaskWriteOutcome {
  const written = ctx.doc.replaceItem(ctx.content, {
    section: ctx.section ?? TASK_QUEUE_SECTION,
    index: task.index,
    text: renderTask(task),
  })
  if (!written.replaced) return { kind: "not_found" }
  return { kind: "ok", content: written.content, task }
}

export function claimNextTask(ctx: TaskQueueContext, args: { claimId: string }): ClaimOutcome {
  const tasks = readTaskQueue(ctx)
  if (tasks.length === 0) return { kind: "exhausted" }

  const doneIds = new Set(tasks.filter((t) => t.state === "done").map((t) => t.id))
  const liveLeases = tasks.filter((t) => t.state === "leased" && !t.stale)
  const heldWorktrees = new Set(
    liveLeases.map((t) => t.worktree).filter((w): w is string => w !== null),
  )

  const claimable = tasks.find(
    (t) =>
      (t.state === "available" || (t.state === "leased" && t.stale))
      && t.worktree !== null
      && !heldWorktrees.has(t.worktree)
      && t.needs.every((need) => doneIds.has(need)),
  )

  if (claimable) {
    const written = writeTask(ctx, {
      ...claimable,
      state: "leased",
      stale: false,
      claimId: args.claimId,
      claimedAt: ctx.now,
      runId: null,
    })
    if (written.kind === "not_found") {
      return { kind: "blocked", problems: [], blockedIds: [claimable.id] }
    }
    return {
      kind: "claimed",
      content: written.content,
      task: written.task,
      claimId: args.claimId,
    }
  }

  const unfinished = tasks.filter((t) => t.state !== "done")
  if (unfinished.length === 0) return { kind: "exhausted" }
  if (liveLeases.length > 0) return { kind: "waiting", leased: liveLeases }
  return {
    kind: "blocked",
    problems: validateTaskQueue(tasks),
    blockedIds: unfinished.map((t) => t.id),
  }
}

export function settleTask(
  ctx: TaskQueueContext,
  args: { claimId: string; outcome: "done" | "release" },
): TaskWriteOutcome {
  const target = readTaskQueue(ctx).find((t) => t.claimId === args.claimId)
  if (!target) return { kind: "not_found" }
  return writeTask(ctx, {
    ...target,
    state: args.outcome === "done" ? "done" : "available",
    stale: false,
    claimId: null,
    claimedAt: null,
    runId: null,
  })
}

export function bindRun(
  ctx: TaskQueueContext,
  args: { claimId: string; runId: string },
): TaskWriteOutcome {
  const target = readTaskQueue(ctx).find((t) => t.claimId === args.claimId)
  if (!target) return { kind: "not_found" }
  return writeTask(ctx, { ...target, runId: args.runId })
}

export function releaseLeasesOfDeadRuns(ctx: TaskQueueContext): { content: string; released: readonly string[] } {
  let content = ctx.content
  const released: string[] = []
  for (const task of readTaskQueue(ctx)) {
    if (task.state !== "leased" || !task.stale) continue
    const written = writeTask(
      { ...ctx, content },
      { ...task, state: "available", stale: false, claimId: null, claimedAt: null, runId: null },
    )
    if (written.kind === "ok") {
      content = written.content
      released.push(task.id)
    }
  }
  return { content, released }
}

export function markIntegrated(
  ctx: TaskQueueContext,
  args: { taskId: string },
): TaskWriteOutcome {
  const target = readTaskQueue(ctx).find((t) => t.id === args.taskId)
  if (!target) return { kind: "not_found" }
  if (target.integrated) return { kind: "ok", content: ctx.content, task: target }
  return writeTask(ctx, { ...target, integrated: true })
}
