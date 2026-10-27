import { StateMarkLabel } from "./state-mark"
import { workflowStatusLabel, workflowStatusTone } from "../../lib/statusLabel"
import type { WorkflowStatus } from "../../../shared/workflow-types"

export function WorkflowStatusPill({ status }: { status: WorkflowStatus }) {
  return <StateMarkLabel tone={workflowStatusTone(status)} label={workflowStatusLabel(status)} />
}
