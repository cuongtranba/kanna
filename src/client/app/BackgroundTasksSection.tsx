import { useCallback, useEffect } from "react"
import { Activity, Bot, ChevronDown, ChevronUp, CircleDashed, SquareTerminal, Workflow } from "lucide-react"
import type { ChatBackgroundTask } from "../../shared/types"
import type { BackgroundTaskOutputSnapshot } from "../../shared/protocol"
import { formatLiveDuration } from "../lib/formatDuration"
import { useNow } from "../hooks/useNow"
import { cn } from "../lib/utils"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { BackgroundTasksSectionStore } from "./BackgroundTasksSection.store"

function taskIcon(taskType: string | null): typeof Bot {
  if (!taskType) return CircleDashed
  if (taskType.includes("bash") || taskType.includes("shell")) return SquareTerminal
  if (taskType.includes("agent") || taskType.includes("task") || taskType.includes("teammate")) return Bot
  if (taskType.includes("workflow")) return Workflow
  return CircleDashed
}

type TaskOutput = Pick<BackgroundTaskOutputSnapshot, "content" | "truncated">

export function outputBodyText(task: ChatBackgroundTask, output: TaskOutput | null): string {
  if (!task.hasOutput) return "This task writes no output file."
  if (output === null) return "Waiting for output…"
  return output.content || "No output yet — nothing has been written to this file."
}

interface Props {
  chatId: string
  tasks: ChatBackgroundTask[]
}

function BackgroundTasksSectionContent({ chatId, tasks }: Props) {
  const now = useNow(1_000)
  const socket = useOptionalKannaSocket()
  const expandedTaskId = BackgroundTasksSectionStore.useScopedStore((s) => s.expandedTaskId)
  const output = BackgroundTasksSectionStore.useScopedStore((s) => s.output)
  const setExpandedTaskId = BackgroundTasksSectionStore.useScopedStore((s) => s.setExpandedTaskId)
  const setOutput = BackgroundTasksSectionStore.useScopedStore((s) => s.setOutput)

  const handleOutput = useCallback((snapshot: BackgroundTaskOutputSnapshot) => {
    setOutput({ taskId: snapshot.taskId, content: snapshot.content, truncated: snapshot.truncated })
  }, [setOutput])

  const streamingTaskId = expandedTaskId !== null
      && tasks.some((task) => task.id === expandedTaskId && task.hasOutput)
    ? expandedTaskId
    : null

  useEffect(() => {
    if (!streamingTaskId || !socket) return
    return socket.subscribe<BackgroundTaskOutputSnapshot>(
      { type: "background-task-output", chatId, taskId: streamingTaskId },
      handleOutput,
    )
  }, [streamingTaskId, chatId, socket, handleOutput])

  return (
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
          const isExpanded = expandedTaskId === task.id
          const taskOutput = output?.taskId === task.id ? output : null
          const canExpand = task.hasOutput || task.command !== null
          return (
            <div key={task.id}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 bg-background",
                  (!isLast || isExpanded) && "border-b border-border",
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
                  {canExpand && (
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={isExpanded ? "Hide output" : "Show output"}
                    >
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4" />
                        : <ChevronDown className="h-4 w-4" />}
                    </button>
                  )}
                </span>
              </div>
              {isExpanded && (
                <div className={cn("bg-card", !isLast && "border-b border-border")}>
                  {task.command !== null && (
                    <div className="px-4 pt-3">
                      <p className="text-xs text-muted-foreground">Command</p>
                      <pre className="mt-1 font-mono text-xs text-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                        {task.command}
                      </pre>
                    </div>
                  )}
                  {task.outputPath !== null && (
                    <p className="px-4 pt-3 font-mono text-xs text-muted-foreground break-all">
                      {task.outputPath}
                    </p>
                  )}
                  {taskOutput?.truncated && (
                    <p className="px-4 pt-2 text-xs text-muted-foreground">Earlier output was truncated.</p>
                  )}
                  <pre className="px-4 py-3 font-mono text-xs text-foreground whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {outputBodyText(task, taskOutput)}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function BackgroundTasksSection({ chatId, tasks }: Props) {
  if (tasks.length === 0) return null
  return (
    <div className="w-full">
      <BackgroundTasksSectionStore.Provider init={undefined}>
        <BackgroundTasksSectionContent chatId={chatId} tasks={tasks} />
      </BackgroundTasksSectionStore.Provider>
    </div>
  )
}
