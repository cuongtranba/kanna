import {
  CalendarClock,
  FolderOpen,
  GitCompare,
  MessageSquare,
  Settings,
  SquareKanban,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { ClaudeSessionLifecycleStatus, KannaStatus } from "../../../shared/types"
import {
  chatStatusIndicator,
  sessionStateBadge,
  type ChatStatusIndicator,
  type SessionStateBadge,
} from "../../lib/chatStatusIndicator"
import type { PageKind, PaneTabTarget } from "../../lib/paneTree"


export interface ChatTabStatus {
  status: KannaStatus
  unread: boolean
  sessionState?: ClaudeSessionLifecycleStatus
}

export interface TabPresentationContext {
  terminalTitles?: Record<string, string>
  liveTerminalIds?: ReadonlySet<string>
  chatTitles?: Record<string, string>
  chatStatuses?: Readonly<Record<string, ChatTabStatus>>
  boardTitles?: Record<string, string>
}

export interface TabPresentation {
  label: string
  icon: LucideIcon
  pinned: boolean
  closable: boolean
  indicator: ChatStatusIndicator | null
  sessionBadge: SessionStateBadge | null
}

const PAGE_PRESENTATION: Readonly<Record<PageKind, { label: string; icon: LucideIcon }>> = {
  projects: { label: "Projects", icon: FolderOpen },
  settings: { label: "Settings", icon: Settings },
  cron: { label: "Cron jobs", icon: CalendarClock },
  workflows: { label: "Workflows", icon: Workflow },
  boards: { label: "Boards", icon: SquareKanban },
}

export function describeTab(
  target: PaneTabTarget,
  context: TabPresentationContext,
): TabPresentation {
  switch (target.kind) {
    case "chat": {
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

    case "page":
      return {
        ...PAGE_PRESENTATION[target.page],
        pinned: false,
        closable: true,
        indicator: null,
        sessionBadge: null,
      }

    case "board":
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
