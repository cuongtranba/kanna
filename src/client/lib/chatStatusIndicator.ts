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

/**
 * Tone as TEXT, which is a different contrast problem from tone as a fill.
 *
 * These returned the raw `--warning` / `--info` / `--success` / `--destructive`
 * tokens. Those are chosen to be legible as BACKGROUNDS, and DESIGN.md is
 * explicit that they fail WCAG AA when used as ink — the `-text` variants exist
 * for exactly this and are machine-checked in tone-pairings.test.ts. The fill
 * helper above still uses the raw tokens, correctly: it paints surfaces.
 */
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

/**
 * The session's warmth, as a drawn mark rather than a Unicode glyph.
 *
 * These were the literal characters ●◐○◌ set as text. A typeface's idea of a
 * filled circle is not this design system's — the four sat at four different
 * optical sizes and weights, and none matched the stroke of any real icon
 * beside them. They are SVG now, at one stroke weight.
 *
 * The vocabulary is deliberately FILL-based, where run state (see stateMark.ts)
 * is stroke-based: a session's warmth and a turn's status are different
 * questions, and a reader should not have to check which one a mark answers.
 */
export type SessionMarkKind = "filled" | "half" | "ring" | "dashed"

export interface SessionStateBadge {
  /** Shape carries the state too, so the badge survives a colour-blind read. */
  kind: SessionMarkKind
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
    case "active": return { kind: "filled", toneClass: "text-success-text", title: "Claude PTY session active" }
    case "warming": return { kind: "half", toneClass: "text-warning-text", title: "Claude PTY session warming" }
    case "idle": return { kind: "ring", toneClass: "text-muted-foreground", title: "Claude PTY session idle" }
    case "cooling": return { kind: "dashed", toneClass: "text-muted-foreground", title: "Claude PTY session cooling down" }
    case "cold":
    default:
      return null
  }
}
