import { log } from "../shared/log"
import { toError } from "../shared/errors"
import type { ModelEscalation } from "./model-escalation"
import type { SessionBackgroundTask } from "./claude-session-state"

export interface BackgroundTaskGuardDeps {
  escalation: ModelEscalation
  isLoopArmed: (chatId: string) => boolean
}

export interface BackgroundTaskGuardSession {
  readonly chatId: string
  readonly backgroundTasksLevelSourced: boolean
  getBackgroundTaskEntries(): Array<[string, SessionBackgroundTask]>
}

export interface BackgroundTaskGuard {
  check: (session: BackgroundTaskGuardSession) => Promise<void>
}

const AGENT_TASK_TYPES = new Set(["local_agent", "remote_agent", "in_process_teammate"])

export function formatBackgroundTaskHarvestPrompt(taskId: string, task: SessionBackgroundTask): string {
  const lines = [
    `A background task you launched is still running and you ended your turn without reporting its result.`,
    ``,
    `Task id: ${taskId}`,
  ]
  if (task.description !== null) lines.push(`Description: ${task.description}`)
  if (task.command !== null) lines.push(`Command: ${task.command}`)
  if (task.outputPath !== null) lines.push(`Output file: ${task.outputPath}`)
  lines.push(``)
  lines.push(
    AGENT_TASK_TYPES.has(task.taskType ?? "")
      ? `Retrieve it now with TaskOutput on that id — start with block: false to see where it stands, and use a bounded block: true only if waiting is what the work needs. Its output file is a symlink to the whole agent transcript, so never open it directly.`
      : `Retrieve it now: call TaskOutput on that id with block: false to see where it stands, or read its output file. If the task is genuinely still working, say so and say what you saw; if it has finished, report the result. Do not end this turn without telling the user one or the other.`,
  )
  return lines.join("\n")
}

export function createBackgroundTaskGuard(deps: BackgroundTaskGuardDeps): BackgroundTaskGuard {
  return {
    check: async (session) => {
      const chatId = session.chatId
      try {
        if (!session.backgroundTasksLevelSourced) return
        const tasks = session.getBackgroundTaskEntries()
        if (tasks.length === 0) return
        if (deps.isLoopArmed(chatId)) return
        for (const [taskId, task] of tasks) {
          await deps.escalation.offer(
            chatId,
            `bgtask-${taskId}`,
            formatBackgroundTaskHarvestPrompt(taskId, task),
            `background-task-harvest-${taskId}`,
          )
        }
      } catch (error) {
        log.warn("[kanna/background-task] guard failed", { chatId, message: toError(error).message })
      }
    },
  }
}
