import { useMemo } from "react"
import { Check, CircleDashed, ListChecks, Loader2 } from "lucide-react"
import type { HydratedTranscriptMessage, TaskStatus } from "../../shared/types"
import { buildTaskProgress } from "../lib/taskProgress"
import { cn } from "../lib/utils"

const ROW_STATUS_CONFIG: Record<
  TaskStatus,
  { Icon: typeof Check; iconClass: string; textClass: string }
> = {
  completed: { Icon: Check, iconClass: "text-success-text", textClass: "text-muted-foreground" },
  in_progress: { Icon: Loader2, iconClass: "text-foreground animate-spin", textClass: "text-foreground font-medium" },
  pending: { Icon: CircleDashed, iconClass: "text-muted-foreground", textClass: "text-muted-foreground" },
}

interface Props {
  messages: HydratedTranscriptMessage[]
}

export function TaskProgressSection({ messages }: Props) {
  const { rows, completed } = useMemo(() => buildTaskProgress(messages), [messages])

  if (rows.length === 0) return null

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-border overflow-hidden">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Tasks
          <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
            {completed}/{rows.length} completed
          </span>
        </h3>
        <div>
          {rows.map((row, index) => {
            const isLast = index === rows.length - 1
            const { Icon, iconClass, textClass } = ROW_STATUS_CONFIG[row.status]
            return (
              <div
                key={row.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 bg-background",
                  !isLast && "border-b border-border",
                )}
              >
                <Icon className={cn("h-4 w-4 flex-shrink-0", iconClass)} />
                <span className={cn("text-sm truncate", textClass)}>{row.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
