import { GitCompare, MessageSquare, SquareKanban, SquareTerminal, type LucideIcon } from "lucide-react"
import type { ClaudeSessionLifecycleStatus, KannaStatus } from "../../../shared/types"
import {
  chatStatusIndicator,
  sessionStateBadge,
  type ChatStatusIndicator,
  type SessionStateBadge,
} from "../../lib/chatStatusIndicator"
import type { PaneTabTarget } from "../../lib/paneTree"

/**
 * Everything a tab shows, derived at render time from its target.
 *
 * A tab stores only an address, so nothing here is persisted. That is what
 * keeps a saved layout from carrying a stale label — rename a terminal and
 * every tab pointing at it renames itself. Status works the same way: the dot
 * is read off the live chat snapshot each render, never remembered on the tab,
 * and it comes from the same table the sidebar row draws itself with, so a
 * running chat cannot read "Running" on the left and blank on its tab.
 */

/** The live facts a chat tab draws itself from. A structural subset of SidebarChatRow. */
export interface ChatTabStatus {
  status: KannaStatus
  unread: boolean
  sessionState?: ClaudeSessionLifecycleStatus
}

export interface TabPresentationContext {
  /** Terminal titles by id, from the terminal layout state. */
  terminalTitles?: Record<string, string>
  /** Terminals with a live PTY; these must survive the retention LRU. */
  liveTerminalIds?: ReadonlySet<string>
  /** Chat titles by chatId, from the sidebar data. */
  chatTitles?: Record<string, string>
  /**
   * Live chat state by chatId, from the same snapshot the sidebar rows render.
   *
   * One map rather than a separate busy-id set beside it: "busy" IS
   * `status ∈ {running, starting}`, and two representations of one fact drift.
   */
  chatStatuses?: Readonly<Record<string, ChatTabStatus>>
  /** Board titles by boardId, from the boards snapshot. */
  boardTitles?: Record<string, string>
}

export interface TabPresentation {
  label: string
  icon: LucideIcon
  /** Exempt from the retention cap — unmounting would destroy live state. */
  pinned: boolean
  closable: boolean
  /** Status dot mirroring the sidebar row; null for a quiet chat and for every non-chat tab. */
  indicator: ChatStatusIndicator | null
  /** Claude PTY session lifecycle glyph, same vocabulary as the sidebar row. */
  sessionBadge: SessionStateBadge | null
}

export function describeTab(
  target: PaneTabTarget,
  context: TabPresentationContext,
): TabPresentation {
  switch (target.kind) {
    case "chat": {
      // Titled by the chat it addresses, so two open chats are tellable apart.
      // Closable now that a chat tab is one of N rather than the only one; a
      // pane with no tabs is a valid state and ChatPage re-opens a tab for the
      // chat in the URL. Pinned while a turn is running — the retention LRU
      // unmounting a live transcript would drop streaming output.
      const chat = context.chatStatuses?.[target.chatId]
      return {
        label: context.chatTitles?.[target.chatId] ?? "Chat",
        icon: MessageSquare,
        pinned: chat?.status === "running" || chat?.status === "starting",
        closable: true,
        indicator: chat ? chatStatusIndicator(chat) : null,
        sessionBadge: sessionStateBadge(chat?.sessionState),
      }
    }

    case "board":
      // Titled by the board it addresses, like a chat tab: a project may own
      // several boards and two open tabs must be tellable apart. Never pinned —
      // a board holds no live stream the retention LRU could drop.
      return {
        label: context.boardTitles?.[target.boardId] ?? "Board",
        icon: SquareKanban,
        pinned: false,
        closable: true,
        indicator: null,
        sessionBadge: null,
      }

    case "changes":
      return {
        label: "Changes",
        icon: GitCompare,
        pinned: false,
        closable: true,
        indicator: null,
        sessionBadge: null,
      }

    case "terminal":
      return {
        label: context.terminalTitles?.[target.terminalId] ?? "Terminal",
        icon: SquareTerminal,
        pinned: context.liveTerminalIds?.has(target.terminalId) ?? false,
        closable: true,
        indicator: null,
        sessionBadge: null,
      }
  }
}
