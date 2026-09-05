import type { KannaStatus } from "../../shared/types"
import type { WorkflowStatus } from "../../shared/workflow-types"
import type { CronRunStatus } from "../../shared/cron/types"

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
    case "active": return "text-foreground"
    case "attention": return "text-warning-text"
    case "destructive": return "text-destructive-text"
    case "muted":
    default: return "text-muted-foreground"
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

export function cronRunLabel(status: CronRunStatus): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "failed": return "Failed"
    case "skipped": return "Skipped"
  }
}

export function cronRunTone(status: CronRunStatus): StatusTone {
  switch (status) {
    case "running": return "active"
    case "failed": return "destructive"
    case "skipped": return "attention"
    case "completed": return "muted"
  }
}
