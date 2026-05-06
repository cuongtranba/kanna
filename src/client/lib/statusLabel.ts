import type { KannaStatus } from "../../shared/types"

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
