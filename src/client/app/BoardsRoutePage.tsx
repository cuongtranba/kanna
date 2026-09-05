import { useCallback } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { BoardsPage } from "../components/boards/BoardsPage"
import { getPathBasename } from "../lib/formatters"
import type { KannaState } from "./useKannaState"
import type { SidebarProjectGroup } from "../../shared/types"

export function BoardsRoutePage() {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
  const { projectId = "" } = useParams<{ projectId: string }>()

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
