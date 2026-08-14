import { GitBranch } from "lucide-react"
import { WorkflowStatusPill } from "../ui/status-pill"
import type { WorkflowRunSummary } from "../../../shared/workflow-types"

interface Props {
  name?: string
  description?: string
  run?: WorkflowRunSummary
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
