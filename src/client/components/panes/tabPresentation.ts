import { GitCompare, MessageSquare, SquareTerminal, type LucideIcon } from "lucide-react"
import type { PaneTabTarget } from "../../lib/paneTree"

/**
 * Everything a tab shows, derived at render time from its target.
 *
 * A tab stores only an address, so nothing here is persisted. That is what
 * keeps a saved layout from carrying a stale label — rename a terminal and
 * every tab pointing at it renames itself.
 */

export interface TabPresentationContext {
  /** Terminal titles by id, from the terminal layout state. */
  terminalTitles?: Record<string, string>
  /** Terminals with a live PTY; these must survive the retention LRU. */
  liveTerminalIds?: ReadonlySet<string>
}

export interface TabPresentation {
  label: string
  icon: LucideIcon
  /** Exempt from the retention cap — unmounting would destroy live state. */
  pinned: boolean
  closable: boolean
}

export function describeTab(
  target: PaneTabTarget,
  context: TabPresentationContext,
): TabPresentation {
  switch (target.kind) {
    case "chat":
      // The transcript is the reason the page exists; closing it would leave a
      // chat route with no chat in it.
      return { label: "Chat", icon: MessageSquare, pinned: false, closable: false }

    case "changes":
      return { label: "Changes", icon: GitCompare, pinned: false, closable: true }

    case "terminal":
      return {
        label: context.terminalTitles?.[target.terminalId] ?? "Terminal",
        icon: SquareTerminal,
        pinned: context.liveTerminalIds?.has(target.terminalId) ?? false,
        closable: true,
      }
  }
}
