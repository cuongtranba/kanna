import type { HydratedToolCall, HydratedTranscriptMessage, TaskStatus } from "../../shared/types"

export interface TaskProgressRow {
  id: string
  label: string
  status: TaskStatus
}

export interface TaskProgressSnapshot {
  rows: TaskProgressRow[]
  completed: number
}

interface TaskRecord {
  id: string
  subject: string
  activeForm?: string
  status: TaskStatus
}

function labelOf(task: TaskRecord): string {
  if (task.status === "in_progress" && task.activeForm) return task.activeForm
  return task.subject
}

function isToolCall(message: HydratedTranscriptMessage): message is HydratedToolCall {
  return message.kind === "tool"
}

function applyCreate(tasks: Map<string, TaskRecord>, message: HydratedToolCall): void {
  if (message.toolKind !== "task_create" || message.isError) return
  const created = message.result?.task
  if (!created?.id) return
  tasks.set(created.id, {
    id: created.id,
    subject: message.input.subject || created.subject,
    activeForm: message.input.activeForm,
    status: "pending",
  })
}

function applyUpdate(tasks: Map<string, TaskRecord>, message: HydratedToolCall): void {
  if (message.toolKind !== "task_update" || message.isError) return
  if (message.result && !message.result.success) return
  const id = message.input.taskId || message.result?.taskId
  if (!id) return
  if (message.input.status === "deleted") {
    tasks.delete(id)
    return
  }
  const existing = tasks.get(id)
  if (!existing) return
  tasks.set(id, {
    ...existing,
    subject: message.input.subject ?? existing.subject,
    activeForm: message.input.activeForm ?? existing.activeForm,
    status: message.input.status ?? existing.status,
  })
}

function applyList(tasks: Map<string, TaskRecord>, message: HydratedToolCall): void {
  if (message.toolKind !== "task_list" || message.isError || !message.result) return
  const listed = message.result.tasks
  if (listed.length === 0) return
  const resynced = new Map<string, TaskRecord>()
  for (const task of listed) {
    const existing = tasks.get(task.id)
    resynced.set(task.id, {
      id: task.id,
      subject: task.subject || existing?.subject || "",
      activeForm: existing?.activeForm,
      status: task.status,
    })
  }
  tasks.clear()
  for (const [id, task] of resynced) tasks.set(id, task)
}

export function buildTaskProgress(messages: HydratedTranscriptMessage[]): TaskProgressSnapshot {
  const tasks = new Map<string, TaskRecord>()

  for (const message of messages) {
    if (message.kind === "context_cleared") {
      tasks.clear()
      continue
    }
    if (!isToolCall(message)) continue
    applyCreate(tasks, message)
    applyUpdate(tasks, message)
    applyList(tasks, message)
  }

  const rows = [...tasks.values()].map((task) => ({
    id: task.id,
    label: labelOf(task),
    status: task.status,
  }))
  return { rows, completed: rows.filter((row) => row.status === "completed").length }
}
