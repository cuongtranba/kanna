import { z } from "zod"
import type { JsonValue } from "../../shared/json"
import { ok, fail, type ToolArgs, type ToolResult } from "../kanna-mcp-tool"
import type { ChatTaskProjection } from "../../shared/chat-tasks/read-model"
import {
  isBlockedByNeeds,
  leaseIsStale,
  selectClaimableTask,
  type ChatTaskProblem,
  type ChatTaskScheduleContext,
} from "../../shared/chat-tasks/schedule"
import {
  CHAT_TASK_EVENT_VERSION,
  MAX_CHAT_TASK_NOTE_CHARS,
  MAX_CHAT_TASK_SUBJECT_CHARS,
  isNativeTaskId,
  kannaTaskId,
  type ChatTaskEvent,
  type ChatTaskNoteKind,
  type ChatTaskPatch,
  type ChatTaskRecord,
  type ChatTaskStatus,
} from "../../shared/chat-tasks/types"

export const TASK_CREATE_DESCRIPTION =
  "Add a task to THIS chat's durable task list. Unlike the CLI's own TaskCreate, this survives /clear, compaction and a server restart, and a subagent's call lands on the parent chat — which is what makes it usable as an autonomous loop's plan. Pass needs to declare dependencies, and worktree/branch when the task will be worked in its own git worktree."

export const TASK_UPDATE_DESCRIPTION =
  "Change a durable task: its status (pending / in_progress / completed), subject, description, dependencies or worktree. Replacing a task's status is how progress is recorded — there is no log to append to and no way for completed work to pile up and be redone."

export const TASK_LIST_DESCRIPTION =
  "List this chat's durable tasks with their status, dependencies and live claims. This is the loop's routine read: it returns subjects and statuses only, so it stays cheap no matter how long the plan grows. Call task_get for one task's notes and full detail."

export const TASK_GET_DESCRIPTION =
  "Read one durable task in full, including its notes (progress, failed approaches, decisions)."

export const TASK_NOTE_DESCRIPTION =
  "Record prose against the plan: kind 'failed_approach' so a later iteration does not repeat a dead end, 'progress' for what was done, 'decision' for why. Omit task_id for a note that belongs to the plan as a whole rather than one task."

export const TASK_CLAIM_DESCRIPTION =
  "Atomically lease ONE claimable task so no two workers ever get the same one. Returns the task plus a claim_id — pass that claim_id to delegate_subagent so the lease binds to the worker's run and is recovered if it dies. A task is claimable only when every id in its needs is completed and its worktree is not held by a live worker. When nothing is claimable the result says which: WAIT (a live worker still holds what the rest depend on — end your turn, it will wake you) or QUEUE BLOCKED (a cycle, an unknown dependency, or a missing worktree — stop and let a human repair the plan)."

export const TASK_SETTLE_DESCRIPTION =
  "Settle a task you claimed. outcome 'done' marks it completed; outcome 'release' returns it to the plan so a later iteration retries it instead of the work being lost. Always call this before terminating — a lease you never settle is only recovered once Kanna notices your run has ended."

export const TASK_INTEGRATE_DESCRIPTION =
  "Merge every completed task branch that is not yet integrated into the loop's integration worktree, so the next worker sees the work its task depends on. Call this FIRST every turn, before claiming. Returns what it merged and what conflicted; a conflict between sibling tasks is a plan defect, so stop the loop and let a human repair it rather than resolving it blind."

export interface ChatTaskToolDeps {
  readonly chatId: string
  readonly appendEvents: (events: readonly ChatTaskEvent[]) => Promise<void>
  readonly project: (ctx: ChatTaskScheduleContext) => ChatTaskProjection
  readonly decide: (
    ctx: ChatTaskScheduleContext,
    fn: (projection: ChatTaskProjection) => readonly ChatTaskEvent[],
  ) => Promise<readonly ChatTaskEvent[]>
  readonly isRunAlive: (runId: string) => boolean
  readonly requireWorktree: () => boolean
  readonly integrationWorkdir: () => string | null
  readonly mergeBranch: (
    workdir: string,
    branch: string,
  ) => Promise<{ ok: boolean; conflicts: readonly string[]; detail: string }>
  readonly now?: () => number
  readonly newId?: () => string
}

export interface ChatTaskView {
  id: string
  subject: string
  status: ChatTaskStatus
  blocked?: true
  stale?: true
  needs?: readonly string[]
  worktree?: string
  branch?: string
  claimId?: string
  runId?: string
  integrated?: true
}

function clamp(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

export function scheduleContext(deps: ChatTaskToolDeps): ChatTaskScheduleContext {
  return {
    now: (deps.now ?? Date.now)(),
    isRunAlive: (runId: string) => deps.isRunAlive(runId),
  }
}

export function viewOf(
  task: ChatTaskRecord,
  all: readonly ChatTaskRecord[],
  projection: ChatTaskProjection,
): ChatTaskView {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    ...(task.status === "pending" && isBlockedByNeeds(task, all) ? { blocked: true } as const : {}),
    ...(projection.staleTaskIds.has(task.id) ? { stale: true } as const : {}),
    ...(task.needs.length > 0 ? { needs: task.needs } : {}),
    ...(task.worktree !== null ? { worktree: task.worktree } : {}),
    ...(task.branch !== null ? { branch: task.branch } : {}),
    ...(task.claimId !== null ? { claimId: task.claimId } : {}),
    ...(task.runId !== null ? { runId: task.runId } : {}),
    ...(task.integrated ? { integrated: true } as const : {}),
  }
}

function describeProblems(problems: readonly ChatTaskProblem[]): string {
  return problems.map((problem) => {
    if (problem.kind === "duplicate_id") return `duplicate id ${problem.id}`
    if (problem.kind === "unknown_dependency") return `${problem.id} needs unknown task ${problem.needs}`
    if (problem.kind === "missing_worktree") return `${problem.id} has no worktree`
    return `dependency cycle: ${problem.ids.join(" → ")}`
  }).join("; ")
}

function baseEvent(deps: ChatTaskToolDeps): {
  v: typeof CHAT_TASK_EVENT_VERSION
  timestamp: number
  chatId: string
} {
  return {
    v: CHAT_TASK_EVENT_VERSION,
    timestamp: (deps.now ?? Date.now)(),
    chatId: deps.chatId,
  }
}

function mintId(deps: ChatTaskToolDeps): string {
  return kannaTaskId((deps.newId ?? (() => crypto.randomUUID().slice(0, 8)))())
}

export interface CreateTaskInput {
  subject: string
  description?: string
  activeForm?: string
  needs?: readonly string[]
  worktree?: string
  branch?: string
}

export async function createChatTask(
  deps: ChatTaskToolDeps,
  input: CreateTaskInput,
): Promise<{ ok: true; task: ChatTaskView } | { ok: false; error: string }> {
  const subject = clamp(input.subject, MAX_CHAT_TASK_SUBJECT_CHARS)
  if (subject.length === 0) return { ok: false, error: "subject is required" }

  const projection = deps.project(scheduleContext(deps))
  const known = new Set(projection.tasks.map((task) => task.id))
  const unknown = (input.needs ?? []).filter((need) => !known.has(need))
  if (unknown.length > 0) {
    return { ok: false, error: `unknown task id in needs: ${unknown.join(", ")}` }
  }

  const taskId = mintId(deps)
  await deps.appendEvents([{
    ...baseEvent(deps),
    type: "chat_task_created",
    taskId,
    subject,
    source: "kanna",
    ...(input.description ? { description: clamp(input.description, MAX_CHAT_TASK_NOTE_CHARS) } : {}),
    ...(input.activeForm ? { activeForm: clamp(input.activeForm, MAX_CHAT_TASK_SUBJECT_CHARS) } : {}),
    ...(input.needs && input.needs.length > 0 ? { needs: [...input.needs] } : {}),
    ...(input.worktree ? { worktree: input.worktree } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
  }])

  const after = deps.project(scheduleContext(deps))
  const created = after.tasks.find((task) => task.id === taskId)
  if (!created) return { ok: false, error: "task was not recorded" }
  return { ok: true, task: viewOf(created, after.tasks, after) }
}

export interface UpdateTaskInput {
  taskId: string
  subject?: string
  description?: string
  activeForm?: string
  status?: ChatTaskStatus | "deleted"
  needs?: readonly string[]
  worktree?: string
  branch?: string
}

export async function updateChatTask(
  deps: ChatTaskToolDeps,
  input: UpdateTaskInput,
): Promise<{ ok: true; task: ChatTaskView | null } | { ok: false; error: string }> {
  const projection = deps.project(scheduleContext(deps))
  const existing = projection.tasks.find((task) => task.id === input.taskId)
  if (!existing) {
    const ids = projection.tasks.map((task) => task.id).slice(0, 20).join(", ")
    return { ok: false, error: `no task ${input.taskId}${ids ? ` — known ids: ${ids}` : " — this chat has no tasks"}` }
  }
  if (isNativeTaskId(input.taskId)) {
    return { ok: false, error: `${input.taskId} is mirrored from the CLI's own task list and is not writable here` }
  }

  if (input.status === "deleted") {
    await deps.appendEvents([{ ...baseEvent(deps), type: "chat_task_deleted", taskId: input.taskId }])
    return { ok: true, task: null }
  }

  const patch: ChatTaskPatch = {
    ...(input.subject !== undefined ? { subject: clamp(input.subject, MAX_CHAT_TASK_SUBJECT_CHARS) } : {}),
    ...(input.description !== undefined ? { description: clamp(input.description, MAX_CHAT_TASK_NOTE_CHARS) } : {}),
    ...(input.activeForm !== undefined ? { activeForm: clamp(input.activeForm, MAX_CHAT_TASK_SUBJECT_CHARS) } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.needs !== undefined ? { needs: [...input.needs] } : {}),
    ...(input.worktree !== undefined ? { worktree: input.worktree } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
  }
  await deps.appendEvents([{ ...baseEvent(deps), type: "chat_task_updated", taskId: input.taskId, patch }])

  const after = deps.project(scheduleContext(deps))
  const updated = after.tasks.find((task) => task.id === input.taskId)
  return { ok: true, task: updated ? viewOf(updated, after.tasks, after) : null }
}

export function listChatTasks(
  deps: ChatTaskToolDeps,
  input: { status?: ChatTaskStatus; limit?: number },
): { tasks: ChatTaskView[]; total: number; completed: number; elided: number } {
  const projection = deps.project(scheduleContext(deps))
  const filtered = input.status
    ? projection.tasks.filter((task) => task.status === input.status)
    : projection.tasks
  const limit = Math.max(1, Math.min(input.limit ?? 200, 200))
  return {
    tasks: filtered.slice(0, limit).map((task) => viewOf(task, projection.tasks, projection)),
    total: projection.tasks.length,
    completed: projection.completedCount,
    elided: Math.max(0, filtered.length - limit),
  }
}

export function getChatTask(
  deps: ChatTaskToolDeps,
  taskId: string,
): { ok: true; task: ChatTaskView; notes: { kind: ChatTaskNoteKind; text: string }[] } | { ok: false; error: string } {
  const projection = deps.project(scheduleContext(deps))
  const task = projection.tasks.find((entry) => entry.id === taskId)
  if (!task) return { ok: false, error: `no task ${taskId}` }
  return {
    ok: true,
    task: viewOf(task, projection.tasks, projection),
    notes: projection.notes
      .filter((note) => note.taskId === taskId)
      .map((note) => ({ kind: note.noteKind, text: note.text })),
  }
}

export async function noteChatTask(
  deps: ChatTaskToolDeps,
  input: { taskId?: string; kind: ChatTaskNoteKind; text: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = clamp(input.text, MAX_CHAT_TASK_NOTE_CHARS)
  if (text.length === 0) return { ok: false, error: "text is required" }
  if (input.taskId !== undefined) {
    const projection = deps.project(scheduleContext(deps))
    if (!projection.tasks.some((task) => task.id === input.taskId)) {
      return { ok: false, error: `no task ${input.taskId}` }
    }
  }
  await deps.appendEvents([{
    ...baseEvent(deps),
    type: "chat_task_note",
    noteId: (deps.newId ?? (() => crypto.randomUUID().slice(0, 8)))(),
    taskId: input.taskId ?? null,
    noteKind: input.kind,
    text,
  }])
  return { ok: true }
}

export type ClaimResult =
  | { kind: "claimed"; task: ChatTaskView; claimId: string }
  | { kind: "waiting"; leased: ChatTaskView[] }
  | { kind: "blocked"; detail: string }
  | { kind: "exhausted" }

export async function claimChatTask(deps: ChatTaskToolDeps): Promise<ClaimResult> {
  const ctx = scheduleContext(deps)
  const requireWorktree = deps.requireWorktree()
  const claimId = (deps.newId ?? (() => crypto.randomUUID().slice(0, 8)))()
  const decided: ClaimResult["kind"][] = []
  const claimedIds: string[] = []
  const waitingRows: ChatTaskRecord[][] = []
  const blockedDetails: string[] = []

  await deps.decide(ctx, (projection) => {
    const events: ChatTaskEvent[] = []
    const reclaimable = projection.tasks.filter(
      (task) => task.status === "in_progress" && leaseIsStale(task, ctx) && task.claimId !== null,
    )
    for (const task of reclaimable) {
      events.push({
        ...baseEvent(deps),
        type: "chat_task_settled",
        taskId: task.id,
        claimId: task.claimId ?? "",
        outcome: "reclaimed",
        reason: "dead_run",
      })
    }

    const live = projection.tasks.map((task) =>
      reclaimable.some((stale) => stale.id === task.id)
        ? { ...task, status: "pending" as const, claimId: null, claimedAt: null, runId: null }
        : task,
    )
    const outcome = selectClaimableTask(live, ctx, { requireWorktree })
    decided.push(outcome.kind === "claimable" ? "claimed" : outcome.kind)
    if (outcome.kind === "waiting") waitingRows.push([...outcome.leased])
    if (outcome.kind === "blocked") {
      const detail = describeProblems(outcome.problems)
      blockedDetails.push(detail.length > 0 ? detail : `blocked: ${outcome.blockedIds.join(", ")}`)
    }
    if (outcome.kind === "claimable") {
      claimedIds.push(outcome.task.id)
      events.push({ ...baseEvent(deps), type: "chat_task_claimed", taskId: outcome.task.id, claimId })
    }
    return events
  })

  const outcomeKind = decided[0] ?? "exhausted"
  if (outcomeKind === "waiting") {
    const after = deps.project(scheduleContext(deps))
    return { kind: "waiting", leased: (waitingRows[0] ?? []).map((task) => viewOf(task, after.tasks, after)) }
  }
  if (outcomeKind === "blocked") return { kind: "blocked", detail: blockedDetails[0] ?? "" }
  if (outcomeKind !== "claimed") return { kind: "exhausted" }

  const after = deps.project(scheduleContext(deps))
  const claimed = after.tasks.find((task) => task.id === (claimedIds[0] ?? ""))
  if (!claimed) return { kind: "exhausted" }
  return { kind: "claimed", task: viewOf(claimed, after.tasks, after), claimId }
}

export async function settleChatTask(
  deps: ChatTaskToolDeps,
  input: { claimId: string; outcome: "done" | "release" },
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const projection = deps.project(scheduleContext(deps))
  const target = projection.tasks.find((task) => task.claimId === input.claimId)
  if (!target) {
    return {
      ok: false,
      error:
        `no task holds claim ${input.claimId} — the lease was reclaimed while your run was in flight, `
        + "so another worker may already be redoing this task. Record what you did with task_note before terminating.",
    }
  }
  await deps.appendEvents([{
    ...baseEvent(deps),
    type: "chat_task_settled",
    taskId: target.id,
    claimId: input.claimId,
    outcome: input.outcome,
    reason: "worker",
  }])
  return { ok: true, taskId: target.id }
}

export async function bindChatTaskRun(
  deps: ChatTaskToolDeps,
  input: { claimId: string; runId: string },
): Promise<void> {
  const projection = deps.project(scheduleContext(deps))
  const target = projection.tasks.find((task) => task.claimId === input.claimId)
  if (!target) return
  await deps.appendEvents([{
    ...baseEvent(deps),
    type: "chat_task_run_bound",
    taskId: target.id,
    claimId: input.claimId,
    runId: input.runId,
  }])
}

export type IntegrateResult =
  | { kind: "nothing" }
  | { kind: "integrated"; taskIds: readonly string[] }
  | { kind: "blocked"; taskId: string; branch: string; detail: string; integrated: readonly string[] }
  | { kind: "no_workdir" }

export async function integrateChatTasks(deps: ChatTaskToolDeps): Promise<IntegrateResult> {
  const workdir = deps.integrationWorkdir()
  if (workdir === null) return { kind: "no_workdir" }

  const projection = deps.project(scheduleContext(deps))
  const pending = projection.tasks.filter(
    (task) => task.status === "completed" && !task.integrated && task.branch !== null,
  )
  if (pending.length === 0) return { kind: "nothing" }

  const integrated: string[] = []
  for (const task of pending) {
    const branch = task.branch
    if (branch === null) continue
    const outcome = await deps.mergeBranch(workdir, branch)
    if (!outcome.ok) {
      return { kind: "blocked", taskId: task.id, branch, detail: outcome.detail, integrated }
    }
    integrated.push(task.id)
    await deps.appendEvents([{ ...baseEvent(deps), type: "chat_task_integrated", taskId: task.id }])
  }
  return { kind: "integrated", taskIds: integrated }
}

export type ChatTaskToolFactory<TTool> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodType<JsonValue | undefined>>,
  handler: (input: ToolArgs) => Promise<ToolResult>,
) => TTool

function str(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function strList(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === "string")
}

function statusOf(value: JsonValue | undefined): ChatTaskStatus | "deleted" | undefined {
  if (value === "pending" || value === "in_progress" || value === "completed" || value === "deleted") return value
  return undefined
}

export function buildChatTaskToolList<TTool>(
  deps: ChatTaskToolDeps | null,
  tool: ChatTaskToolFactory<TTool>,
): TTool[] {
  if (!deps) return []
  const bound = deps
  return [
    tool("task_create", TASK_CREATE_DESCRIPTION, {
      subject: z.string().describe("One line naming the work"),
      description: z.string().optional().describe("Detail an implementer would need"),
      active_form: z.string().optional().describe("Present continuous label shown while the task runs"),
      needs: z.array(z.string()).optional().describe("Task ids that must be completed first"),
      worktree: z.string().optional().describe("Absolute path of the git worktree this task is worked in"),
      branch: z.string().optional().describe("Branch name for this task's work"),
    }, async (input) => {
      const result = await createChatTask(bound, {
        subject: str(input.subject) ?? "",
        ...(str(input.description) ? { description: str(input.description) ?? "" } : {}),
        ...(str(input.active_form) ? { activeForm: str(input.active_form) ?? "" } : {}),
        ...(strList(input.needs) ? { needs: strList(input.needs) ?? [] } : {}),
        ...(str(input.worktree) ? { worktree: str(input.worktree) ?? "" } : {}),
        ...(str(input.branch) ? { branch: str(input.branch) ?? "" } : {}),
      })
      return result.ok ? ok(JSON.stringify(result.task)) : fail(result.error)
    }),
    tool("task_update", TASK_UPDATE_DESCRIPTION, {
      task_id: z.string().describe("Task id from task_list"),
      status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional().describe("New status; 'deleted' removes the task"),
      subject: z.string().optional(),
      description: z.string().optional(),
      active_form: z.string().optional(),
      needs: z.array(z.string()).optional(),
      worktree: z.string().optional(),
      branch: z.string().optional(),
    }, async (input) => {
      const result = await updateChatTask(bound, {
        taskId: str(input.task_id) ?? "",
        ...(statusOf(input.status) ? { status: statusOf(input.status) ?? "pending" } : {}),
        ...(str(input.subject) !== undefined ? { subject: str(input.subject) ?? "" } : {}),
        ...(str(input.description) !== undefined ? { description: str(input.description) ?? "" } : {}),
        ...(str(input.active_form) !== undefined ? { activeForm: str(input.active_form) ?? "" } : {}),
        ...(strList(input.needs) ? { needs: strList(input.needs) ?? [] } : {}),
        ...(str(input.worktree) !== undefined ? { worktree: str(input.worktree) ?? "" } : {}),
        ...(str(input.branch) !== undefined ? { branch: str(input.branch) ?? "" } : {}),
      })
      if (!result.ok) return fail(result.error)
      return ok(result.task ? JSON.stringify(result.task) : "deleted")
    }),
    tool("task_list", TASK_LIST_DESCRIPTION, {
      status: z.enum(["pending", "in_progress", "completed"]).optional().describe("Restrict to one status"),
      limit: z.number().int().min(1).max(200).optional(),
    }, async (input) => {
      const status = statusOf(input.status)
      const listed = listChatTasks(bound, {
        ...(status && status !== "deleted" ? { status } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      })
      return ok(JSON.stringify(listed))
    }),
    tool("task_get", TASK_GET_DESCRIPTION, {
      task_id: z.string().describe("Task id from task_list"),
    }, async (input) => {
      const result = getChatTask(bound, str(input.task_id) ?? "")
      return result.ok ? ok(JSON.stringify({ task: result.task, notes: result.notes })) : fail(result.error)
    }),
    tool("task_note", TASK_NOTE_DESCRIPTION, {
      kind: z.enum(["progress", "failed_approach", "decision"]).describe("What sort of note this is"),
      text: z.string().describe("The note itself"),
      task_id: z.string().optional().describe("Task this note belongs to; omit for a plan-wide note"),
    }, async (input) => {
      const kind = input.kind
      if (kind !== "progress" && kind !== "failed_approach" && kind !== "decision") {
        return fail("kind must be progress, failed_approach or decision")
      }
      const result = await noteChatTask(bound, {
        kind,
        text: str(input.text) ?? "",
        ...(str(input.task_id) ? { taskId: str(input.task_id) ?? "" } : {}),
      })
      return result.ok ? ok("recorded") : fail(result.error)
    }),
    tool("task_claim", TASK_CLAIM_DESCRIPTION, {}, async () => {
      const result = await claimChatTask(bound)
      if (result.kind === "claimed") {
        return ok(JSON.stringify({ claim_id: result.claimId, task: result.task }))
      }
      if (result.kind === "waiting") {
        return ok(JSON.stringify({ status: "WAIT", leased: result.leased }))
      }
      if (result.kind === "blocked") {
        return ok(JSON.stringify({ status: "QUEUE BLOCKED", detail: result.detail }))
      }
      return ok(JSON.stringify({ status: "exhausted" }))
    }),
    tool("task_settle", TASK_SETTLE_DESCRIPTION, {
      claim_id: z.string().describe("The claim_id task_claim returned"),
      outcome: z.enum(["done", "release"]).describe("'done' completes the task; 'release' returns it to the plan"),
    }, async (input) => {
      const outcome = input.outcome === "release" ? "release" : "done"
      const result = await settleChatTask(bound, { claimId: str(input.claim_id) ?? "", outcome })
      return result.ok ? ok(`${result.taskId} ${outcome}`) : fail(result.error)
    }),
    tool("task_integrate", TASK_INTEGRATE_DESCRIPTION, {}, async () => {
      const result = await integrateChatTasks(bound)
      if (result.kind === "no_workdir") {
        return fail("no integration worktree is set for this loop")
      }
      if (result.kind === "nothing") return ok(JSON.stringify({ status: "nothing_to_integrate" }))
      if (result.kind === "blocked") {
        return ok(JSON.stringify({
          status: "QUEUE BLOCKED",
          integrated: result.integrated,
          conflict: { task: result.taskId, branch: result.branch, detail: result.detail },
        }))
      }
      return ok(JSON.stringify({ status: "integrated", integrated: result.taskIds }))
    }),
  ]
}
