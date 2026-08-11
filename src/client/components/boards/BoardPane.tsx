import { useCallback, useEffect } from "react"
import { ChevronLeft, Columns2, RefreshCw, Settings2 } from "lucide-react"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { useBoardSyncStore } from "./BoardPane.store"
import { CardDrawer } from "./CardDrawer"
import { BoardSyncPanel } from "./BoardSyncPanel"
import { useBoardsStore, selectBoardPageSize, selectBoardView } from "../../stores/boardsStore"
import { KannaBoard, type CardMoveRequest } from "./KannaBoard"
import { moveCardInView, moveColumnInView } from "../../lib/boards/optimistic"
import type { ColumnSettingsValue } from "./ColumnSettings"
import type { BoardSnapshot } from "../../../shared/protocol"
import { errorMessage, type AnyValue } from "../../../shared/errors"

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
  /** Present on the boards route, absent in a pane — a pane has nowhere to go back to. */
  onBack?: () => void
  /** Move this board into the pane workspace. Absent when it is already there. */
  onOpenBesideChat?: () => void
  /**
   * Whether {@link onOpenBesideChat} will have to start a chat.
   *
   * The pane workspace only exists on the chat route, so a project with none
   * gets one. The button says so rather than doing it quietly.
   */
  besideChatStartsChat?: boolean
}

export function BoardPane({
  boardId,
  socket,
  onOpenCard,
  onBack,
  onOpenBesideChat,
  besideChatStartsChat = false,
}: BoardPaneProps) {
  const view = useBoardsStore(selectBoardView(boardId))
  const pageSize = useBoardsStore(selectBoardPageSize(boardId))

  // Re-subscribing on a raised page size IS the paging: the server rebuilds
  // every board broadcast from this topic, so each push carries a complete
  // prefix of each column and nothing has to be merged.
  useEffect(() => {
    return socket.subscribe<BoardSnapshot>({ type: "board", boardId, pageSize }, (snapshot) => {
      useBoardsStore.getState().setBoardView(snapshot.boardId, snapshot.view)
    })
  }, [boardId, pageSize, socket])

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

  const openCardId = useBoardSyncStore((state) => state.openCardId)

  const handleOpenCard = useCallback(
    (cardId: string) => {
      useBoardSyncStore.getState().openCard(cardId)
      onOpenCard?.(cardId)
    },
    [onOpenCard],
  )

  const handleCloseCard = useCallback(() => {
    useBoardSyncStore.getState().closeCard()
  }, [])

  const syncPanelOpen = useBoardSyncStore((state) => state.syncPanelOpen)

  const handleOpenSyncPanel = useCallback(() => {
    useBoardSyncStore.getState().openSyncPanel()
  }, [])

  const handleCloseSyncPanel = useCallback(() => {
    useBoardSyncStore.getState().closeSyncPanel()
  }, [])

  const syncing = useBoardSyncStore((state) => state.syncingBoardId === boardId)
  const syncMessage = useBoardSyncStore((state) => state.messageByBoard[boardId] ?? null)

  const handleSync = useCallback(() => {
    const sync = useBoardSyncStore.getState()
    sync.startSync(boardId)
    void socket
      .command<{ created: number; updated: number; unchanged: number; conflicts: number }>({
        type: "board.sync.pull",
        boardId,
      })
      .then((summary) => {
        const conflicts = summary.conflicts > 0 ? `, ${String(summary.conflicts)} conflicts` : ""
        sync.finishSync(
          boardId,
          `Synced · ${String(summary.created)} new, ${String(summary.updated)} updated${conflicts}`,
        )
      })
      // The reason is shown inline on the header, not as a toast: the user may
      // not be looking when a sync fails.
      .catch((cause: AnyValue) => {
        sync.finishSync(boardId, errorMessage(cause))
      })
  }, [boardId, socket])

  /**
   * Column edits are not optimistic except for the reorder, which must land
   * under the cursor. A rename or a delete is a deliberate act with a visible
   * outcome, so waiting one round-trip for the authoritative snapshot is
   * honest; guessing would only be able to disagree with it.
   */
  const handleColumnMove = useCallback(
    (columnId: string, afterColumnId: string | null) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      if (current) useBoardsStore.getState().setBoardView(boardId, moveColumnInView(current, columnId, afterColumnId))
      void socket.command({ type: "board.column.move", columnId, afterColumnId }).catch(() => {
        // The authoritative snapshot is the correction.
      })
    },
    [boardId, socket],
  )

  const handleColumnSave = useCallback(
    (columnId: string, patch: ColumnSettingsValue) => {
      void socket
        .command({
          type: "board.column.update",
          columnId,
          title: patch.title,
          semantic: patch.semantic,
          colorToken: patch.colorToken,
          wipLimit: patch.wipLimit,
        })
        .catch((cause: AnyValue) => {
          useBoardSyncStore.getState().finishSync(boardId, errorMessage(cause))
        })
    },
    [boardId, socket],
  )

  const handleColumnDelete = useCallback(
    (columnId: string) => {
      // The store refuses while cards remain; surfacing its reason is the point.
      void socket.command({ type: "board.column.delete", columnId }).catch((cause: AnyValue) => {
        useBoardSyncStore.getState().finishSync(boardId, errorMessage(cause))
      })
    },
    [boardId, socket],
  )

  const handleColumnAdd = useCallback(
    (title: string) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      const afterColumnId = current?.columns.at(-1)?.id ?? null
      void socket.command({ type: "board.column.create", boardId, title, afterColumnId }).catch((cause: AnyValue) => {
        useBoardSyncStore.getState().finishSync(boardId, errorMessage(cause))
      })
    },
    [boardId, socket],
  )

  const handleCardAdd = useCallback(
    (columnId: string, title: string) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      // Append: a card typed at the foot of a column belongs at the foot of it.
      const afterCardId = current?.cards[columnId]?.at(-1)?.id ?? null
      void socket
        .command({ type: "board.card.create", boardId, columnId, title, afterCardId })
        .catch((cause: AnyValue) => {
          useBoardSyncStore.getState().finishSync(boardId, errorMessage(cause))
        })
    },
    [boardId, socket],
  )

  const renaming = useBoardSyncStore((state) => state.renamingBoardId === boardId)
  const titleDraft = useBoardSyncStore((state) => state.titleDraft)

  const handleStartRename = useCallback(() => {
    const current = useBoardsStore.getState().viewByBoard[boardId]
    if (current) useBoardSyncStore.getState().startRenameBoard(boardId, current.board.title)
  }, [boardId])

  const handleTitleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useBoardSyncStore.getState().setTitleDraft(event.currentTarget.value)
  }, [])

  /**
   * Commit on Enter or on losing focus; an empty name is a cancel, not a board
   * with no name.
   */
  const handleCommitRename = useCallback(() => {
    const { titleDraft: draft } = useBoardSyncStore.getState()
    const current = useBoardsStore.getState().viewByBoard[boardId]
    useBoardSyncStore.getState().stopRenameBoard()
    const title = draft.trim()
    if (title === "" || title === current?.board.title) return
    void socket.command({ type: "board.update", boardId, title }).catch((cause: AnyValue) => {
      useBoardSyncStore.getState().finishSync(boardId, errorMessage(cause))
    })
  }, [boardId, socket])

  const handleTitleKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") handleCommitRename()
      if (event.key === "Escape") useBoardSyncStore.getState().stopRenameBoard()
    },
    [handleCommitRename],
  )

  // Focus and select on mount so typing replaces the old name outright.
  const focusTitle = useCallback((element: HTMLInputElement | null) => {
    element?.select()
  }, [])

  const handleLoadMore = useCallback(() => {
    useBoardsStore.getState().growPage(boardId)
  }, [boardId])

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">Loading board…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Back to boards"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
        ) : null}
        {renaming ? (
          <input
            ref={focusTitle}
            value={titleDraft}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKey}
            onBlur={handleCommitRename}
            aria-label="Board name"
            className="min-w-0 flex-1 rounded-md bg-secondary px-1.5 py-0.5 text-[15px] font-semibold text-foreground focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={handleStartRename}
            className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-[15px] font-semibold text-foreground hover:bg-secondary"
          >
            {view.board.title}
          </button>
        )}
        {syncMessage ? (
          <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">{syncMessage}</span>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw aria-hidden className={cn("size-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync"}
        </Button>
        {onOpenBesideChat ? (
          <Button variant="ghost" size="sm" onClick={onOpenBesideChat}>
            <Columns2 aria-hidden className="size-3.5" />
            {besideChatStartsChat ? "Open beside a new chat" : "Open beside chat"}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={handleOpenSyncPanel} aria-label="Sync settings">
          <Settings2 aria-hidden className="size-3.5" />
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        {syncPanelOpen ? (
          <BoardSyncPanel boardId={boardId} socket={socket} onClose={handleCloseSyncPanel} />
        ) : null}
        {openCardId ? (
          <CardDrawer cardId={openCardId} socket={socket} onClose={handleCloseCard} />
        ) : null}
        <KannaBoard
          view={view}
          onCardMove={handleCardMove}
          onColumnMove={handleColumnMove}
          onOpenCard={handleOpenCard}
          onLoadMore={handleLoadMore}
          onColumnSave={handleColumnSave}
          onColumnDelete={handleColumnDelete}
          onColumnAdd={handleColumnAdd}
          onCardAdd={handleCardAdd}
        />
      </div>
    </div>
  )
}
