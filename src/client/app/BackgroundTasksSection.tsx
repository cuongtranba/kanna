import { Activity, Bot, CircleDashed, SquareTerminal, Workflow } from "lucide-react"
import type { ChatBackgroundTask } from "../../shared/types"
import { formatLiveDuration } from "../lib/formatDuration"
import { useNow } from "../hooks/useNow"
import { cn } from "../lib/utils"

function taskIcon(taskType: string | null): typeof Bot {
  if (!taskType) return CircleDashed
  if (taskType.includes("bash") || taskType.includes("shell")) return SquareTerminal
  if (taskType.includes("agent") || taskType.includes("task") || taskType.includes("teammate")) return Bot
  if (taskType.includes("workflow")) return Workflow
  return CircleDashed
}

interface Props {
  tasks: ChatBackgroundTask[]
}

/**
 * Live list of Claude-Code background tasks (Bash run_in_background,
 * background Agent runs, workflows) on this chat's warm session — the
 * Kanna analog of Claude Code's /tasks view.
 */
export function BackgroundTasksSection({ tasks }: Props) {
  const now = useNow(1_000)
  if (tasks.length === 0) return null

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-border overflow-hidden">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Background tasks
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            {tasks.length} running
          </span>
        </h3>
        <div>
          {tasks.map((task, index) => {
            const Icon = taskIcon(task.taskType)
            const isLast = index === tasks.length - 1
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 bg-background",
                  !isLast && "border-b border-border",
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-sm text-foreground truncate">
                  {task.description ?? "Background task"}
                </span>
                <span className="ml-auto flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatLiveDuration(Math.max(0, now - task.startedAt))}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
