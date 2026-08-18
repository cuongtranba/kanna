import { useCallback } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { BoardsPage } from "../components/boards/BoardsPage"
import { getPathBasename } from "../lib/formatters"
import type { KannaState } from "./useKannaState"
import type { SidebarProjectGroup } from "../../shared/types"

/**
 * Route for `/boards/:projectId` — the list, and only the list.
 *
 * Opening a board hands it to `/boards/:projectId/:boardId`, which the workspace
 * owns: a board is a pane tab, so it arrives beside whatever chats are already
 * open and the tab strip is how the reader moves between them. Looking at a
 * board still starts no conversation — the workspace paints from its tabs, not
 * from a chat.
 */
export function BoardsRoutePage() {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
  const { projectId = "" } = useParams<{ projectId: string }>()

  // `groupKey` IS the project id (read-models.ts: `groupKey: project.id`), which
  // is also what the project context menu keys hide/star/archive on.
  const groups: SidebarProjectGroup[] = [
    ...state.sidebarData.starredProjectGroups,
    ...state.sidebarData.projectGroups,
  ]
  const group = groups.find((candidate) => candidate.groupKey === projectId)
  const projectName = group ? getPathBasename(group.localPath) : "Project"

  const handleOpenBoard = useCallback(
    (openedBoardId: string) => {
      void navigate(`/boards/${projectId}/${openedBoardId}`)
    },
    [navigate, projectId],
  )

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <BoardsPage
        ownerKind="project"
        ownerId={projectId}
        ownerName={projectName}
        socket={state.socket}
        onOpenBoard={handleOpenBoard}
      />
    </div>
  )
}
