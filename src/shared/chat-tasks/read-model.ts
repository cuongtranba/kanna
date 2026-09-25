import { leaseIsStale, type ChatTaskScheduleContext } from "./schedule"
import {
  MAX_CHAT_TASK_NOTES,
  isNativeTaskId,
  nativeTaskId,
  nativeTaskScope,
  type ChatTaskEvent,
  type ChatTaskNote,
  type ChatTaskPatch,
  type ChatTaskRecord,
} from "./types"

export interface ChatTaskProjection {
  readonly tasks: readonly ChatTaskRecord[]
  readonly notes: readonly ChatTaskNote[]
  readonly epoch: number
  readonly completedCount: number
  readonly staleTaskIds: ReadonlySet<string>
}

export const EMPTY_CHAT_TASK_PROJECTION: ChatTaskProjection = {
  tasks: [],
  notes: [],
  epoch: 0,
  completedCount: 0,
  staleTaskIds: new Set<string>(),
}

function applyPatch(task: ChatTaskRecord, patch: ChatTaskPatch, at: number): ChatTaskRecord {
  const status = patch.status ?? task.status
  const completedAt = status === "completed"
    ? (task.completedAt ?? at)
    : null
  return {
    ...task,
    subject: patch.subject ?? task.subject,
    activeForm: patch.activeForm === undefined ? task.activeForm : patch.activeForm,
    description: patch.description === undefined ? task.description : patch.description,
    status,
    needs: patch.needs ?? task.needs,
    worktree: patch.worktree === undefined ? task.worktree : patch.worktree,
    branch: patch.branch === undefined ? task.branch : patch.branch,
    updatedAt: at,
    completedAt,
  }
}

function syncNativeRows(
  tasks: Map<string, ChatTaskRecord>,
  event: Extract<ChatTaskEvent, { type: "chat_task_native_synced" }>,
  epoch: number,
): void {
  if (event.rows.length === 0) return
  const scope = event.scope ?? null
  for (const id of [...tasks.keys()]) {
    if (isNativeTaskId(id) && nativeTaskScope(id) === scope) tasks.delete(id)
  }
  for (const row of event.rows) {
    const id = nativeTaskId(row.nativeId, scope)
    const existing = tasks.get(id)
    tasks.set(id, {
      id,
      subject: row.subject.length > 0 ? row.subject : (existing?.subject ?? ""),
      activeForm: existing?.activeForm ?? null,
      description: existing?.description ?? null,
      status: row.status,
      source: "native",
      needs: existing?.needs ?? [],
      worktree: existing?.worktree ?? null,
      branch: existing?.branch ?? null,
      integrated: existing?.integrated ?? false,
      claimId: null,
      claimedAt: null,
      runId: null,
      epoch,
      originRunId: existing?.originRunId ?? null,
      createdAt: existing?.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
      completedAt: row.status === "completed" ? (existing?.completedAt ?? event.timestamp) : null,
    })
  }
}

function applyEvent(
  tasks: Map<string, ChatTaskRecord>,
  notes: ChatTaskNote[],
  epochRef: { value: number },
  event: ChatTaskEvent,
): void {
  switch (event.type) {
    case "chat_task_created": {
      if (tasks.has(event.taskId)) return
      tasks.set(event.taskId, {
        id: event.taskId,
        subject: event.subject,
        activeForm: event.activeForm ?? null,
        description: event.description ?? null,
        status: "pending",
        source: event.source,
        needs: event.needs ?? [],
        worktree: event.worktree ?? null,
        branch: event.branch ?? null,
        integrated: false,
        claimId: null,
        claimedAt: null,
        runId: null,
        epoch: epochRef.value,
        originRunId: event.originRunId ?? null,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        completedAt: null,
      })
      return
    }
    case "chat_task_updated": {
      const task = tasks.get(event.taskId)
      if (!task) return
      tasks.set(event.taskId, applyPatch(task, event.patch, event.timestamp))
      return
    }
    case "chat_task_deleted": {
      tasks.delete(event.taskId)
      return
    }
    case "chat_task_claimed": {
      const task = tasks.get(event.taskId)
      if (!task) return
      tasks.set(event.taskId, {
        ...task,
        status: "in_progress",
        claimId: event.claimId,
        claimedAt: event.timestamp,
        runId: null,
        originRunId: event.originRunId ?? task.originRunId,
        updatedAt: event.timestamp,
      })
      return
    }
    case "chat_task_run_bound": {
      const task = tasks.get(event.taskId)
      if (!task || task.claimId !== event.claimId) return
      tasks.set(event.taskId, { ...task, runId: event.runId, updatedAt: event.timestamp })
      return
    }
    case "chat_task_settled": {
      const task = tasks.get(event.taskId)
      if (!task) return
      const completed = event.outcome === "done"
      tasks.set(event.taskId, {
        ...task,
        status: completed ? "completed" : "pending",
        claimId: null,
        claimedAt: null,
        runId: null,
        updatedAt: event.timestamp,
        completedAt: completed ? (task.completedAt ?? event.timestamp) : null,
      })
      return
    }
    case "chat_task_integrated": {
      const task = tasks.get(event.taskId)
      if (!task) return
      tasks.set(event.taskId, { ...task, integrated: true, updatedAt: event.timestamp })
      return
    }
    case "chat_task_note": {
      notes.push({
        id: event.noteId,
        taskId: event.taskId,
        noteKind: event.noteKind,
        text: event.text,
        originRunId: event.originRunId ?? null,
        createdAt: event.timestamp,
      })
      if (notes.length > MAX_CHAT_TASK_NOTES) notes.splice(0, notes.length - MAX_CHAT_TASK_NOTES)
      return
    }
    case "chat_task_epoch_advanced": {
      epochRef.value = event.epoch
      return
    }
    case "chat_task_native_synced": {
      syncNativeRows(tasks, event, epochRef.value)
    }
  }
}

export function deriveChatTasks(
  events: readonly ChatTaskEvent[],
  ctx: ChatTaskScheduleContext,
): ChatTaskProjection {
  const tasks = new Map<string, ChatTaskRecord>()
  const notes: ChatTaskNote[] = []
  const epochRef = { value: 0 }

  for (const event of events) applyEvent(tasks, notes, epochRef, event)

  const list = [...tasks.values()]
  const staleTaskIds = new Set<string>()
  for (const task of list) {
    if (leaseIsStale(task, ctx)) staleTaskIds.add(task.id)
    else if (isNativeTaskId(task.id) && task.epoch < epochRef.value) staleTaskIds.add(task.id)
  }

  return {
    tasks: list,
    notes,
    epoch: epochRef.value,
    completedCount: list.filter((task) => task.status === "completed").length,
    staleTaskIds,
  }
}
