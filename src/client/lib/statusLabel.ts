import type { KannaStatus } from "../../shared/types"
import type { WorkflowStatus } from "../../shared/workflow-types"

export function statusLabel(status: KannaStatus): string {
  switch (status) {
    case "idle": return "Idle"
    case "starting": return "Starting"
    case "running": return "Running"
    case "waiting_for_user": return "Waiting"
    case "failed": return "Failed"
  }
}

export type StatusTone = "muted" | "active" | "attention" | "destructive"

export function statusTone(status: KannaStatus): StatusTone {
  switch (status) {
    case "running": return "active"
    case "waiting_for_user": return "attention"
    case "failed": return "destructive"
    case "idle":
    case "starting":
    default: return "muted"
  }
}

export function statusToneClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "text-emerald-500 dark:text-emerald-400"
    case "attention": return "text-amber-500 dark:text-amber-400"
    case "destructive": return "text-destructive"
    case "muted":
    default: return "text-muted-foreground"
  }
}

export function statusToneDotClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "bg-emerald-500 dark:bg-emerald-400"
    case "attention": return "bg-amber-500 dark:bg-amber-400"
    case "destructive": return "bg-destructive"
    case "muted":
    default: return "bg-muted-foreground"
  }
}

export function workflowStatusLabel(status: WorkflowStatus): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "failed": return "Failed"
    case "killed": return "Killed"
    case "unknown": return "Unknown"
  }
}

export function workflowStatusTone(status: WorkflowStatus): StatusTone {
  switch (status) {
    case "running": return "active"
    case "failed": return "destructive"
    case "killed": return "attention"
    case "completed":
    case "unknown":
    default: return "muted"
  }
}
