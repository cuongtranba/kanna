import type { ClaudeSessionLifecycleStatus, KannaStatus } from "../../shared/types"
import { statusLabel } from "./statusLabel"

/**
 * The one status vocabulary a chat is drawn with, wherever it appears.
 *
 * This table used to live privately inside the sidebar's ChatRow. The pane tab
 * strip shows the SAME chats, so a copy there would have been a second table
 * free to drift — the same chat reading "Running" on the left and showing
 * nothing on its tab. Both surfaces now derive from here, so they cannot
 * disagree by construction.
 *
 * Colours are theme tokens (bg-warning / bg-info / …), never raw hex: the
 * design gate rejects hex, and a token follows the palette into dark mode.
 */

/**
 * `muted` is not produced by `chatStatusIndicator` below — it exists for
 * surfaces that speak about work which is *scheduled* rather than running,
 * where amber would over-claim (it states "attention available"). The board
 * card's cron row is the first such caller.
 */
export type ChatDotTone = "warning" | "info" | "success" | "destructive" | "muted"

/** The status inputs a dot is derived from — a structural subset of SidebarChatRow. */
export interface ChatIndicatorInput {
  status: KannaStatus
  unread: boolean
}

export interface ChatStatusIndicator {
  tone: ChatDotTone
  /**
   * The status in words. Pairs with the colour so meaning never rides on hue
   * alone (DESIGN.md, Color-Plus Rule) — rendered as the trailing stamp in the
   * sidebar, as tooltip + screen-reader text on a tab.
   */
  label: string
}

/**
 * Live state wins over unread: a chat that is running is running whether or not
 * its last output has been read, and "unread" is the only tone that survives an
 * otherwise quiet chat.
 */
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
    case "warning": return "text-warning"
    case "info": return "text-info"
    case "success": return "text-success"
    case "destructive": return "text-destructive"
    case "muted":
    default: return "text-muted-foreground"
  }
}

export interface SessionStateBadge {
  /** Shape carries the state too, so the badge survives a colour-blind read. */
  glyph: string
  toneClass: string
  title: string
}

/**
 * The Claude PTY session's own lifecycle, which is not the turn status: a chat
 * can sit idle with a warm session, or be running on one still warming up.
 * `cold` (and an absent value, which means cold) draws nothing.
 */
export function sessionStateBadge(
  state: ClaudeSessionLifecycleStatus | undefined,
): SessionStateBadge | null {
  switch (state) {
    case "active": return { glyph: "●", toneClass: "text-success", title: "Claude PTY session active" }
    case "warming": return { glyph: "◐", toneClass: "text-warning", title: "Claude PTY session warming" }
    case "idle": return { glyph: "○", toneClass: "text-muted-foreground", title: "Claude PTY session idle" }
    case "cooling": return { glyph: "◌", toneClass: "text-muted-foreground", title: "Claude PTY session cooling down" }
    case "cold":
    default:
      return null
  }
}
