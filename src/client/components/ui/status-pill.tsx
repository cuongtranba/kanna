import { cn } from "../../lib/utils"
import {
  statusToneClass,
  statusToneDotClass,
  workflowStatusLabel,
  workflowStatusTone,
  type StatusTone,
} from "../../lib/statusLabel"
import type { WorkflowStatus } from "../../../shared/workflow-types"

export function StatusPill({ tone, label }: { tone: StatusTone; label: string; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium">
      <span
        aria-hidden
        className={cn("inline-block size-1.5 rounded-full", statusToneDotClass(tone))}
      />
      <span className={statusToneClass(tone)}>{label}</span>
    </span>
  )
}

export function WorkflowStatusPill({ status, pulse = false }: { status: WorkflowStatus; pulse?: boolean }) {
  return (
    <StatusPill
      tone={workflowStatusTone(status)}
      label={workflowStatusLabel(status)}
      pulse={pulse && status === "running"}
    />
  )
}
