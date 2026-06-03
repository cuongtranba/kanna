import { GitBranch } from "lucide-react"
import { cn } from "../../lib/utils"
import type { WorkflowRunSummary, WorkflowStatus } from "../../../shared/workflow-types"

interface Props {
  name?: string
  description?: string
  run?: WorkflowRunSummary
}

type StatusTone = "muted" | "active" | "destructive" | "warning"

function statusTone(status: WorkflowStatus): StatusTone {
  switch (status) {
    case "running": return "active"
    case "failed": return "destructive"
    case "killed": return "warning"
    case "completed":
    case "unknown":
    default: return "muted"
  }
}

function statusLabel(status: WorkflowStatus): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "failed": return "Failed"
    case "killed": return "Killed"
    case "unknown": return "Unknown"
  }
}

function dotClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "bg-emerald-500 dark:bg-emerald-400"
    case "destructive": return "bg-destructive"
    case "warning": return "bg-amber-500 dark:bg-amber-400"
    case "muted":
    default: return "bg-muted-foreground"
  }
}

function textClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "text-emerald-500 dark:text-emerald-400"
    case "destructive": return "text-destructive"
    case "warning": return "text-amber-500 dark:text-amber-400"
    case "muted":
    default: return "text-muted-foreground"
  }
}

function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  const tone = statusTone(status)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span aria-hidden className={cn("inline-block size-1.5 rounded-full", dotClass(tone))} />
      <span className={textClass(tone)}>{statusLabel(status)}</span>
    </span>
  )
}

function StartedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      started…
    </span>
  )
}

export function WorkflowMessage({ name, description, run }: Props) {
  const displayName = name ?? "Workflow"

  return (
    <div className="flex items-center gap-2 min-w-0">
      <GitBranch className="size-4 text-muted-icon shrink-0" />
      <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
        <span className="font-medium text-foreground/80 text-sm truncate">{displayName}</span>
        {description && (
          <span className="text-xs text-muted-foreground truncate">{description}</span>
        )}
        {run ? (
          <>
            <WorkflowStatusPill status={run.status} />
            {run.agentCount != null && run.agentCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">{run.agentCount} agents</span>
            )}
          </>
        ) : (
          <StartedPill />
        )}
      </div>
    </div>
  )
}
