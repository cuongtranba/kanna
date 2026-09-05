import { StateMarkLabel } from "./state-mark"
import { workflowStatusLabel, workflowStatusTone, type StatusTone } from "../../lib/statusLabel"
import type { WorkflowStatus } from "../../../shared/workflow-types"

export function StatusPill({ tone, label }: { tone: StatusTone; label: string; pulse?: boolean }) {
  return <StateMarkLabel tone={tone} label={label} />
}

export function WorkflowStatusPill({ status }: { status: WorkflowStatus; pulse?: boolean }) {
  return (
    <StatusPill tone={workflowStatusTone(status)} label={workflowStatusLabel(status)} />
  )
}
