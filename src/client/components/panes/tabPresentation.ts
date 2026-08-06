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
  /** Chat titles by chatId, from the sidebar data. */
  chatTitles?: Record<string, string>
  /** Chats with an in-flight turn; losing one to the retention LRU would drop a live transcript. */
  busyChatIds?: ReadonlySet<string>
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
      // Titled by the chat it addresses, so two open chats are tellable apart.
      // Closable now that a chat tab is one of N rather than the only one; a
      // pane with no tabs is a valid state and ChatPage re-opens a tab for the
      // chat in the URL. Pinned while a turn is running — the retention LRU
      // unmounting a live transcript would drop streaming output.
      return {
        label: context.chatTitles?.[target.chatId] ?? "Chat",
        icon: MessageSquare,
        pinned: context.busyChatIds?.has(target.chatId) ?? false,
        closable: true,
      }

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
