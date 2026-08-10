import { useCallback, useEffect } from "react"
import { useBoardsStore, selectBoardView } from "../../stores/boardsStore"
import { KannaBoard, type CardMoveRequest } from "./KannaBoard"
import { moveCardInView } from "../../lib/boards/optimistic"
import type { BoardSnapshot } from "../../../shared/protocol"
import type { AnyValue } from "../../../shared/errors"

/**
 * One board, live.
 *
 * Subscribes to the board topic and renders whatever the server last sent. A
 * drag applies locally first (so the card lands under the cursor) and is then
 * sent as a command; the server's snapshot push replaces the optimistic state a
 * round-trip later, which is also how a rejected move self-corrects.
 */

export interface BoardPaneSocket {
  subscribe<TSnapshot>(topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void): () => void
  command<TResult = AnyValue>(command: AnyValue): Promise<TResult>
}

export interface BoardPaneProps {
  boardId: string
  socket: BoardPaneSocket
  onOpenCard?: (cardId: string) => void
}

export function BoardPane({ boardId, socket, onOpenCard }: BoardPaneProps) {
  const view = useBoardsStore(selectBoardView(boardId))

  useEffect(() => {
    return socket.subscribe<BoardSnapshot>({ type: "board", boardId }, (snapshot) => {
      useBoardsStore.getState().setBoardView(snapshot.boardId, snapshot.view)
    })
  }, [boardId, socket])

  const handleCardMove = useCallback(
    (move: CardMoveRequest) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      if (current) useBoardsStore.getState().setBoardView(boardId, moveCardInView(current, move))
      void socket
        .command({
          type: "board.card.move",
          cardId: move.cardId,
          toColumnId: move.toColumnId,
          aboveCardId: move.aboveCardId,
          belowCardId: move.belowCardId,
        })
        .catch(() => {
          // The authoritative snapshot is the correction: ask for it rather
          // than guessing how to undo a move the server refused.
        })
    },
    [boardId, socket],
  )

  const handleOpenCard = useCallback(
    (cardId: string) => {
      onOpenCard?.(cardId)
    },
    [onOpenCard],
  )

  const handleLoadMore = useCallback(() => {
    // Paging lands with the card drawer; the snapshot's first page covers the
    // common board until then, and the skeletons above it are honest about
    // what is missing.
  }, [])

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">Loading board…</p>
      </div>
    )
  }

  if (view.columns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-background p-8 text-center">
        <p className="text-sm font-medium text-foreground">This board has no columns yet.</p>
        <p className="max-w-[46ch] text-sm text-muted-foreground">
          Add a column to start tracking work your agents can pick up.
        </p>
      </div>
    )
  }

  return (
    <KannaBoard
      view={view}
      onCardMove={handleCardMove}
      onOpenCard={handleOpenCard}
      onLoadMore={handleLoadMore}
    />
  )
}
