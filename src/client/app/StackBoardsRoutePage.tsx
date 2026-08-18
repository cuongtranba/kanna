import { useCallback } from "react"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { BoardsPage } from "../components/boards/BoardsPage"
import type { KannaState } from "./useKannaState"

/**
 * Route for `/boards/stack/:stackId` — the list, and only the list.
 *
 * Mirrors `BoardsRoutePage`, one owner kind over: a Stack board has no single
 * project checkout to imply, so the owner is the Stack itself. Opening a board
 * hands it to `/boards/stack/:stackId/:boardId`, which the workspace owns the
 * same way it owns a project board's address.
 */
export function StackBoardsRoutePage() {
  const state = useOutletContext<KannaState>()
  const navigate = useNavigate()
  const { stackId = "" } = useParams<{ stackId: string }>()

  const stack = state.sidebarData.stacks.find((candidate) => candidate.id === stackId)
  const stackName = stack ? stack.title : "Stack"

  const handleOpenBoard = useCallback(
    (openedBoardId: string) => {
      void navigate(`/boards/stack/${stackId}/${openedBoardId}`)
    },
    [navigate, stackId],
  )

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <BoardsPage
        ownerKind="stack"
        ownerId={stackId}
        ownerName={stackName}
        socket={state.socket}
        onOpenBoard={handleOpenBoard}
      />
    </div>
  )
}
