import { CHAT_TASK_EVENT_VERSION, kannaTaskId, type ChatTaskEvent } from "./types"

export interface SeedTaskInput {
  subject: string
  needs?: readonly string[]
  worktree?: string
  branch?: string
}

export function buildSeedTaskEvents(args: {
  chatId: string
  now: number
  tasks: readonly SeedTaskInput[]
  failedApproaches: readonly string[]
  newId: () => string
}): readonly ChatTaskEvent[] {
  const base = { v: CHAT_TASK_EVENT_VERSION, timestamp: args.now, chatId: args.chatId } as const
  const idBySubject = new Map<string, string>()
  const events: ChatTaskEvent[] = []

  for (const task of args.tasks) {
    const subject = task.subject.trim()
    if (subject.length === 0) continue
    const taskId = kannaTaskId(args.newId())
    idBySubject.set(subject, taskId)
    events.push({
      ...base,
      type: "chat_task_created",
      taskId,
      subject,
      source: "kanna",
      ...(task.needs && task.needs.length > 0 ? { needs: [...task.needs] } : {}),
      ...(task.worktree !== undefined ? { worktree: task.worktree } : {}),
      ...(task.branch !== undefined ? { branch: task.branch } : {}),
    })
  }

  for (const text of args.failedApproaches) {
    const trimmed = text.trim()
    if (trimmed.length === 0) continue
    events.push({
      ...base,
      type: "chat_task_note",
      noteId: args.newId(),
      taskId: null,
      noteKind: "failed_approach",
      text: trimmed,
    })
  }

  return events
}
