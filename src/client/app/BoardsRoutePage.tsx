import { useCallback } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { BoardsPage } from "../components/boards/BoardsPage"
import { BoardPane } from "../components/boards/BoardPane"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { getPathBasename } from "../lib/formatters"
import type { KannaState } from "./useKannaState"
import type { SidebarProjectGroup } from "../../shared/types"

/**
 * Route wrapper for `/boards/:projectId` and `/boards/:projectId/:boardId`.
 *
 * A board opens HERE, on its own address — full width, no pane, no chat.
 * Looking at a board is not a conversation, and it should not start one.
 *
 * Opening it beside a chat is a second, explicit action, and the only path that
 * may create a chat. This route used to do that on EVERY open: the pane
 * workspace lives on the chat route, so a board tab needs a chat to be rendered
 * next to, and with none in the project the click otherwise produced a tab
 * nobody could see. Satisfying that constraint by manufacturing a chat the
 * reader never asked for was the wrong way round.
 */
export function BoardsRoutePage() {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
  const { projectId = "", boardId } = useParams<{ projectId: string; boardId?: string }>()

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
    (openedBoardId: string) => {
      void navigate(`/boards/${projectId}/${openedBoardId}`)
    },
    [navigate, projectId],
  )

  const handleBack = useCallback(() => {
    void navigate(`/boards/${projectId}`)
  }, [navigate, projectId])

  /**
   * Move the board into the pane workspace, beside a chat.
   *
   * That workspace only exists on the chat route, so this navigates there. A
   * project with no chat gets one — but only because the reader asked for this
   * specific thing, and the button says so before they click it.
   */
  const handleOpenBesideChat = useCallback(() => {
    if (!boardId) return
    usePaneLayoutStore.getState().openTab({ kind: "board", boardId })
    if (existingChatId) {
      state.chatNavigator.openChat(existingChatId)
      return
    }
    void state.handleCreateChat(projectId)
  }, [boardId, existingChatId, projectId, state])

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {boardId ? (
        <BoardPane
          boardId={boardId}
          socket={state.socket}
          onBack={handleBack}
          onOpenBesideChat={handleOpenBesideChat}
          besideChatStartsChat={existingChatId === null}
        />
      ) : (
        <BoardsPage
          projectId={projectId}
          projectName={projectName}
          socket={state.socket}
          onOpenBoard={handleOpenBoard}
        />
      )}
    </div>
  )
}
