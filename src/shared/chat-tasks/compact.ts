import { deriveChatTasks } from "./read-model"
import {
  MAX_CHAT_TASKS_PER_CHAT,
  MAX_CHAT_TASK_NOTES,
  type ChatTaskEvent,
} from "./types"

function taskIdOf(event: ChatTaskEvent): string | null {
  switch (event.type) {
    case "chat_task_created":
    case "chat_task_updated":
    case "chat_task_deleted":
    case "chat_task_claimed":
    case "chat_task_run_bound":
    case "chat_task_settled":
    case "chat_task_integrated":
      return event.taskId
    case "chat_task_note":
      return event.taskId
    default:
      return null
  }
}

function lastEventTypeByTask(events: readonly ChatTaskEvent[]): Map<string, ChatTaskEvent["type"]> {
  const last = new Map<string, ChatTaskEvent["type"]>()
  for (const event of events) {
    const id = taskIdOf(event)
    if (id !== null) last.set(id, event.type)
  }
  return last
}

function evictableCompletedIds(events: readonly ChatTaskEvent[]): Set<string> {
  const projection = deriveChatTasks(events, { now: 0 })
  const completed = projection.tasks
    .filter((task) => task.status === "completed")
    .sort((a, b) => (a.completedAt ?? a.updatedAt) - (b.completedAt ?? b.updatedAt))
  const overflow = projection.tasks.length - MAX_CHAT_TASKS_PER_CHAT
  if (overflow <= 0) return new Set<string>()
  return new Set(completed.slice(0, Math.min(overflow, completed.length)).map((task) => task.id))
}

export function compactChatTaskEvents(events: readonly ChatTaskEvent[]): ChatTaskEvent[] {
  const lastType = lastEventTypeByTask(events)
  const drop = evictableCompletedIds(events)
  for (const [id, type] of lastType) {
    if (type === "chat_task_deleted") drop.add(id)
  }
  if (drop.size === 0 && events.length <= MAX_CHAT_TASK_NOTES * 4) return [...events]

  const kept = events.filter((event) => {
    const id = taskIdOf(event)
    return id === null || !drop.has(id)
  })

  const noteIndexes: number[] = []
  kept.forEach((event, index) => {
    if (event.type === "chat_task_note") noteIndexes.push(index)
  })
  if (noteIndexes.length <= MAX_CHAT_TASK_NOTES) return kept

  const dropNoteIndexes = new Set(noteIndexes.slice(0, noteIndexes.length - MAX_CHAT_TASK_NOTES))
  return kept.filter((_, index) => !dropNoteIndexes.has(index))
}
