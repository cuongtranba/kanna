import { useCallback } from "react"
import { useOutletContext, useParams } from "react-router-dom"
import { BoardsPage } from "../components/boards/BoardsPage"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { getPathBasename } from "../lib/formatters"
import type { KannaState } from "./useKannaState"
import type { SidebarProjectGroup } from "../../shared/types"

/**
 * Route wrapper for `/boards/:projectId`.
 *
 * Opening a board adds a pane tab and then navigates into the project's most
 * recent chat, because the pane WORKSPACE only exists on the chat route — that
 * is where a board sitting beside a live transcript is the point.
 *
 * A project with no chat yet has nowhere to put the pane, so opening a board
 * starts one. That used to leave the route alone instead, which opened a tab
 * the reader could not see and looked like nothing happening. The page says so
 * before the click rather than surprising them after it; an unused chat is
 * reaped on its own, so the cost of being wrong is nil.
 */
export function BoardsRoutePage() {
  const state = useOutletContext<KannaState>()
  const { projectId = "" } = useParams<{ projectId: string }>()

  // `groupKey` IS the project id (read-models.ts: `groupKey: project.id`), which
  // is also what the project context menu keys hide/star/archive on.
  const groups: SidebarProjectGroup[] = [
    ...state.sidebarData.starredProjectGroups,
    ...state.sidebarData.projectGroups,
  ]
  const group = groups.find((candidate) => candidate.groupKey === projectId)
  const projectName = group ? getPathBasename(group.localPath) : "Project"

  const existingChatId = group?.chats[0]?.chatId ?? group?.previewChats[0]?.chatId ?? null

  const handleOpenBoard = useCallback(
    (boardId: string) => {
      usePaneLayoutStore.getState().openTab({ kind: "board", boardId })
      if (existingChatId) {
        state.chatNavigator.openChat(existingChatId)
        return
      }
      // `handleCreateChat` navigates into the new chat itself, which is where
      // the tab opened above becomes visible.
      void state.handleCreateChat(projectId)
    },
    [existingChatId, projectId, state],
  )

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <BoardsPage
        projectId={projectId}
        projectName={projectName}
        hasChat={existingChatId !== null}
        socket={state.socket}
        onOpenBoard={handleOpenBoard}
      />
    </div>
  )
}
