import type { ClaudeSessionLifecycleStatus, KannaStatus } from "../../shared/types"
import { statusLabel } from "./statusLabel"


export type ChatDotTone = "warning" | "info" | "success" | "destructive" | "muted"

export interface ChatIndicatorInput {
  status: KannaStatus
  unread: boolean
}

export interface ChatStatusIndicator {
  tone: ChatDotTone
  label: string
}

export function chatStatusIndicator(input: ChatIndicatorInput): ChatStatusIndicator | null {
  if (input.status === "running" || input.status === "starting") {
    return { tone: "warning", label: statusLabel(input.status) }
  }
  if (input.status === "waiting_for_user") {
    return { tone: "info", label: statusLabel(input.status) }
  }
  if (input.status === "failed") {
    return { tone: "destructive", label: statusLabel(input.status) }
  }
  if (input.unread) return { tone: "success", label: "Unread" }
  return null
}

export function chatDotBgClass(tone: ChatDotTone | null): string {
  switch (tone) {
    case "warning": return "bg-warning"
    case "info": return "bg-info"
    case "success": return "bg-success"
    case "destructive": return "bg-destructive"
    case "muted": return "bg-muted-foreground"
    default: return ""
  }
}

export function chatDotTextClass(tone: ChatDotTone | null): string {
  switch (tone) {
    case "warning": return "text-warning-text"
    case "info": return "text-info-text"
    case "success": return "text-success-text"
    case "destructive": return "text-destructive-text"
    case "muted":
    default: return "text-muted-foreground"
  }
}

export type SessionMarkKind = "filled" | "half" | "ring" | "dashed"

export interface SessionStateBadge {
  kind: SessionMarkKind
  toneClass: string
  title: string
}

export function sessionStateBadge(
  state: ClaudeSessionLifecycleStatus | undefined,
): SessionStateBadge | null {
  switch (state) {
    case "active": return { kind: "filled", toneClass: "text-success-text", title: "Claude PTY session active" }
    case "warming": return { kind: "half", toneClass: "text-warning-text", title: "Claude PTY session warming" }
    case "idle": return { kind: "ring", toneClass: "text-muted-foreground", title: "Claude PTY session idle" }
    case "cooling": return { kind: "dashed", toneClass: "text-muted-foreground", title: "Claude PTY session cooling down" }
    case "cold":
    default:
      return null
  }
}
