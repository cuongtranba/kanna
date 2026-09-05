import type { TabPresentationContext } from "../../components/panes/tabPresentation"
import type { ProjectTerminalLayout } from "../../stores/terminalLayoutStore"
import type { BoardSummary, BoardViewSnapshot } from "../../../shared/boards/types"
import type { SidebarData } from "../../../shared/types"


export interface TabPresentationSources {
  terminalProjects: Record<string, ProjectTerminalLayout>
  sidebarData: SidebarData
  boardsByOwner: Record<string, readonly BoardSummary[]>
  boardViews?: Record<string, BoardViewSnapshot | null>
}

export function buildTabPresentationContext(
  sources: TabPresentationSources,
): TabPresentationContext {
  const chatRows = [
    ...sources.sidebarData.starredProjectGroups,
    ...sources.sidebarData.projectGroups,
  ].flatMap((group) => [...group.chats, ...group.previewChats, ...group.olderChats])

  return {
    terminalTitles: Object.fromEntries(
      Object.values(sources.terminalProjects).flatMap((layout) =>
        layout.terminals.map((terminal) => [terminal.id, terminal.title] as const),
      ),
    ),
    chatTitles: Object.fromEntries(chatRows.map((row) => [row.chatId, row.title])),
    chatStatuses: Object.fromEntries(
      chatRows.map((row) => [
        row.chatId,
        { status: row.status, unread: row.unread, sessionState: row.sessionState },
      ]),
    ),
    boardTitles: Object.fromEntries([
      ...Object.values(sources.boardViews ?? {}).flatMap((view) =>
        view ? [[view.board.id, view.board.title] as const] : [],
      ),
      ...Object.values(sources.boardsByOwner).flatMap((boards) =>
        boards.map((board) => [board.id, board.title] as const),
      ),
    ]),
  }
}
