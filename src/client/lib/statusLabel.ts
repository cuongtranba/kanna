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

/**
 * Tone colours, drawn only from the design tokens.
 *
 * These were `emerald-500` and `amber-500` — raw Tailwind palette values that
 * appear nowhere in DESIGN.md's warm rose system, so every status in the app was
 * painted off-palette. They are also no longer load-bearing: state is carried by
 * the mark's shape (see `stateMark.ts`), and colour is only allowed to agree.
 * `active` is therefore full ink rather than a hue — a live session is the one
 * thing on screen that should read at full strength.
 */
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
