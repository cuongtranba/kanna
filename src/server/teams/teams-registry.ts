import type { TeamTaskEvent } from "../harness-types"
import type { TeamTaskSummary } from "../../shared/types"

export interface TeamsRegistry {
  apply(chatId: string, event: TeamTaskEvent): void
  snapshot(chatId: string): TeamTaskSummary[]
  clear(chatId: string): void
  subscribe(cb: (chatId: string) => void): () => void
}

export function createTeamsRegistry(deps: { now: () => number }): TeamsRegistry {
  const { now } = deps

  // Map<chatId, Map<taskId, TeamTaskSummary>> — insertion order preserved
  const store = new Map<string, Map<string, TeamTaskSummary>>()
  const subscribers = new Set<(chatId: string) => void>()

  function notify(chatId: string): void {
    for (const cb of subscribers) {
      cb(chatId)
    }
  }

  function getTasks(chatId: string): Map<string, TeamTaskSummary> | undefined {
    return store.get(chatId)
  }

  function getOrCreateTasks(chatId: string): Map<string, TeamTaskSummary> {
    let tasks = store.get(chatId)
    if (!tasks) {
      tasks = new Map()
      store.set(chatId, tasks)
    }
    return tasks
  }

  function isTerminalStatus(status: string): status is "completed" | "failed" {
    return status === "completed" || status === "failed"
  }

  return {
    apply(chatId: string, event: TeamTaskEvent): void {
      const { subtype, taskId } = event

      if (subtype === "task_started") {
        const tasks = getOrCreateTasks(chatId)
        const ts = now()
        const summary: TeamTaskSummary = {
          taskId,
          name: event.name,
          subagentType: event.subagentType,
          description: event.description ?? event.name ?? taskId,
          status: "running",
          model: event.model,
          startedAt: ts,
          lastActivityAt: ts,
        }
        tasks.set(taskId, summary)
        notify(chatId)
        return
      }

      if (subtype === "task_progress") {
        const tasks = getTasks(chatId)
        const existing = tasks?.get(taskId)
        if (!existing) return // unknown task — ignore, no notify
        existing.lastActivityAt = now()
        notify(chatId)
        return
      }

      if (subtype === "task_updated") {
        const tasks = getTasks(chatId)
        const existing = tasks?.get(taskId)
        if (!existing) return // unknown task — ignore, no notify

        const patch = event.patch
        if (patch) {
          if (patch.status !== undefined && isTerminalStatus(patch.status)) {
            existing.status = patch.status
            existing.endedAt = patch.end_time ?? now()
          }
        }
        existing.lastActivityAt = now()
        notify(chatId)
        return
      }

      if (subtype === "task_notification") {
        const tasks = getTasks(chatId)
        const existing = tasks?.get(taskId)
        if (!existing) return // unknown task — ignore, no notify

        const status = event.status
        if (status !== undefined && isTerminalStatus(status) && !isTerminalStatus(existing.status)) {
          existing.status = status
          existing.endedAt = now()
          notify(chatId)
        }
        return
      }
    },

    snapshot(chatId: string): TeamTaskSummary[] {
      const tasks = store.get(chatId)
      if (!tasks) return []
      return Array.from(tasks.values())
    },

    clear(chatId: string): void {
      store.delete(chatId)
    },

    subscribe(cb: (chatId: string) => void): () => void {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
  }
}
