import { cn } from "../../lib/utils"
import {
  statusToneClass,
  statusToneDotClass,
  workflowStatusLabel,
  workflowStatusTone,
  type StatusTone,
} from "../../lib/statusLabel"
import type { WorkflowStatus } from "../../../shared/workflow-types"

export function StatusPill({ tone, label, pulse = false }: { tone: StatusTone; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span
        aria-hidden
        className={cn("inline-block size-1.5 rounded-full", statusToneDotClass(tone), pulse && "animate-pulse")}
      />
      <span className={statusToneClass(tone)}>{label}</span>
    </span>
  )
}

/** `pulse` animates the dot while the run is still in flight. */
export function WorkflowStatusPill({ status, pulse = false }: { status: WorkflowStatus; pulse?: boolean }) {
  return (
    <StatusPill
      tone={workflowStatusTone(status)}
      label={workflowStatusLabel(status)}
      pulse={pulse && status === "running"}
    />
  )
}
