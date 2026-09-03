import { StateMarkLabel } from "./state-mark"
import { workflowStatusLabel, workflowStatusTone, type StatusTone } from "../../lib/statusLabel"
import type { WorkflowStatus } from "../../../shared/workflow-types"

/**
 * A status is a mark and its word — no dot, no box.
 *
 * The bordered pill spent a whole card's worth of chrome saying what one stroke
 * says, and the dot inside it carried its state in hue alone. The mark's shape
 * is the signal now, so this reads the same in greyscale and at a glance.
 *
 * The name and props are unchanged so every existing call site inherits the new
 * treatment without edits.
 */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string; pulse?: boolean }) {
  return <StateMarkLabel tone={tone} label={label} />
}

export function WorkflowStatusPill({ status }: { status: WorkflowStatus; pulse?: boolean }) {
  return (
    <StatusPill tone={workflowStatusTone(status)} label={workflowStatusLabel(status)} />
  )
}
