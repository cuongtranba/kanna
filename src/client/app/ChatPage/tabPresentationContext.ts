import type { TabPresentationContext } from "../../components/panes/tabPresentation"
import type { ProjectTerminalLayout } from "../../stores/terminalLayoutStore"
import type { BoardSummary, BoardViewSnapshot } from "../../../shared/boards/types"
import type { SidebarData } from "../../../shared/types"

/**
 * Everything the tab strip needs to title and status a tab, gathered from the
 * live snapshots rather than remembered on the tab itself.
 *
 * Read from EVERY project, not the active one: the workspace is shared, so a
 * chat, terminal or board opened in project A stays open while the user works
 * in project B, and titling from the active project alone silently renames it
 * to its fallback. Boards shipped without this and every board tab read
 * "Board".
 */

export interface TabPresentationSources {
  terminalProjects: Record<string, ProjectTerminalLayout>
  sidebarData: SidebarData
  /** Keyed `${ownerKind}:${ownerId}` — see `boardsStore`'s `ownerKey`. */
  boardsByOwner: Record<string, readonly BoardSummary[]>
  /**
   * Open boards, keyed by id. Landing straight on `/boards/:projectId/:boardId`
   * — a refresh, a bookmark — subscribes to that ONE board and never to the
   * project's list, so the list alone would leave the tab on its fallback.
   */
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
    // Carries "busy" too: a chat mid-turn holds streaming state that unmounting
    // would discard, so the strip pins it against the retention LRU.
    chatStatuses: Object.fromEntries(
      chatRows.map((row) => [
        row.chatId,
        { status: row.status, unread: row.unread, sessionState: row.sessionState },
      ]),
    ),
    // The list is written second so a rename that has reached the list wins
    // over the view's copy, which only refreshes on the board's own push.
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
