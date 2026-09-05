import { useCallback, useEffect, useMemo } from "react"
import { ListChecks, RefreshCw, Settings2 } from "lucide-react"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { useBoardSyncStore } from "./BoardPane.store"
import { CardDrawer } from "./CardDrawer"
import type { BlockerCandidate } from "./CardDependencies"
import { BoardSyncPanel } from "./BoardSyncPanel"
import { CardSchemaPanel } from "./CardSchemaPanel"
import { useCardSchemaStore } from "./CardSchemaPanel.store"
import { useBoardsStore, selectBoardPageSize, selectBoardView } from "../../stores/boardsStore"
import type { BoardChatFacts } from "../../lib/boards/boardChatFacts"
import { KannaBoard, type CardMoveRequest } from "./KannaBoard"
import { moveCardInView, moveColumnInView } from "../../lib/boards/optimistic"
import type { ColumnSettingsValue } from "./ColumnSettings"
import type { BoardSnapshot, ClientCommand, SubscriptionTopic } from "../../../shared/protocol"
import { onRejected } from "../../../shared/errors"
import type { JsonValue } from "../../../shared/json"


export interface BoardPaneSocket {
  subscribe(topic: SubscriptionTopic, onSnapshot: (snapshot: BoardSnapshot) => void): () => void
  command<TResult = JsonValue>(command: ClientCommand): Promise<TResult>
}

const EMPTY_CANDIDATES: readonly BlockerCandidate[] = []

export interface BoardPaneProps {
  boardId: string
  socket: BoardPaneSocket
  chatFacts?: Readonly<Record<string, BoardChatFacts>>
  onOpenCard?: (cardId: string) => void
  onOpenBoards?: (projectId: string) => void
}

export function BoardPane({ boardId, socket, chatFacts, onOpenCard, onOpenBoards }: BoardPaneProps) {
  const view = useBoardsStore(selectBoardView(boardId))
  const pageSize = useBoardsStore(selectBoardPageSize(boardId))

  useEffect(() => {
    return socket.subscribe({ type: "board", boardId, pageSize }, (snapshot) => {
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

  const schemaPanelOpen = useBoardSyncStore((state) => state.schemaPanelOpen)

  const handleOpenSchemaPanel = useCallback(() => {
    const current = useBoardsStore.getState().viewByBoard[boardId]
    if (!current) return
    useCardSchemaStore.getState().open(current.board.cardFields)
    useBoardSyncStore.getState().openSchemaPanel()
  }, [boardId])

  const handleCloseSchemaPanel = useCallback(() => {
    useBoardSyncStore.getState().closeSchemaPanel()
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
      .catch(onRejected((error) => {
        sync.finishSync(boardId, error.message)
      }))
  }, [boardId, socket])

  const handleColumnMove = useCallback(
    (columnId: string, afterColumnId: string | null) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      if (current) useBoardsStore.getState().setBoardView(boardId, moveColumnInView(current, columnId, afterColumnId))
      void socket.command({ type: "board.column.move", columnId, afterColumnId }).catch(() => {
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
        .catch(onRejected((error) => {
          useBoardSyncStore.getState().finishSync(boardId, error.message)
        }))
    },
    [boardId, socket],
  )

  const handleColumnDelete = useCallback(
    (columnId: string) => {
      void socket.command({ type: "board.column.delete", columnId }).catch(onRejected((error) => {
        useBoardSyncStore.getState().finishSync(boardId, error.message)
      }))
    },
    [boardId, socket],
  )

  const handleColumnAdd = useCallback(
    (title: string) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      const afterColumnId = current?.columns.at(-1)?.id ?? null
      void socket.command({ type: "board.column.create", boardId, title, afterColumnId }).catch(onRejected((error) => {
        useBoardSyncStore.getState().finishSync(boardId, error.message)
      }))
    },
    [boardId, socket],
  )

  const handleMoveToTop = useCallback(
    (cardId: string) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      if (!current) return
      const card = Object.values(current.cards).flat().find((c) => c.id === cardId)
      if (!card) return
      const columnCards = current.cards[card.columnId] ?? []
      const topCard = columnCards[0]
      if (topCard?.id === cardId) return
      void socket
        .command({
          type: "board.card.move",
          cardId,
          toColumnId: card.columnId,
          aboveCardId: null,
          belowCardId: topCard?.id ?? null,
        })
        .catch(() => {
        })
    },
    [boardId, socket],
  )

  const handleCardAdd = useCallback(
    (columnId: string, title: string) => {
      const current = useBoardsStore.getState().viewByBoard[boardId]
      const afterCardId = current?.cards[columnId]?.at(-1)?.id ?? null
      void socket
        .command({ type: "board.card.create", boardId, columnId, title, afterCardId })
        .catch(onRejected((error) => {
          useBoardSyncStore.getState().finishSync(boardId, error.message)
        }))
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

  const handleCommitRename = useCallback(() => {
    const { titleDraft: draft } = useBoardSyncStore.getState()
    const current = useBoardsStore.getState().viewByBoard[boardId]
    useBoardSyncStore.getState().stopRenameBoard()
    const title = draft.trim()
    if (title === "" || title === current?.board.title) return
    void socket.command({ type: "board.update", boardId, title }).catch(onRejected((error) => {
      useBoardSyncStore.getState().finishSync(boardId, error.message)
    }))
  }, [boardId, socket])

  const handleTitleKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") handleCommitRename()
      if (event.key === "Escape") useBoardSyncStore.getState().stopRenameBoard()
    },
    [handleCommitRename],
  )

  const focusTitle = useCallback((element: HTMLInputElement | null) => {
    element?.select()
  }, [])

  const handleLoadMore = useCallback(() => {
    useBoardsStore.getState().growPage(boardId)
  }, [boardId])

  const ownerProjectId =
    view && view.board.ownerKind === "project" && onOpenBoards ? view.board.ownerId : null

  const handleOpenBoards = useCallback(() => {
    if (ownerProjectId) onOpenBoards?.(ownerProjectId)
  }, [onOpenBoards, ownerProjectId])

  const blockerCandidates = useMemo<readonly BlockerCandidate[]>(() => {
    if (!view) return EMPTY_CANDIDATES
    return view.columns.flatMap((column) =>
      (view.cards[column.id] ?? []).map((card) => ({ id: card.id, title: card.title })),
    )
  }, [view])

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">Loading board…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        {ownerProjectId ? (
          <>
            <button
              type="button"
              onClick={handleOpenBoards}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-13 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Boards
            </button>
            <span aria-hidden className="shrink-0 text-13 text-muted-foreground">
              /
            </span>
          </>
        ) : null}
        {renaming ? (
          <input
            ref={focusTitle}
            value={titleDraft}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKey}
            onBlur={handleCommitRename}
            aria-label="Board name"
            className="min-w-0 flex-1 rounded-md bg-secondary px-1.5 py-0.5 text-15 font-semibold text-foreground focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={handleStartRename}
            className="min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-15 font-semibold text-foreground hover:bg-secondary"
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
        <Button variant="ghost" size="sm" onClick={handleOpenSchemaPanel} aria-label="Card fields">
          <ListChecks aria-hidden className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleOpenSyncPanel} aria-label="Sync settings">
          <Settings2 aria-hidden className="size-3.5" />
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        {syncPanelOpen ? (
          <BoardSyncPanel boardId={boardId} socket={socket} onClose={handleCloseSyncPanel} />
        ) : null}
        {schemaPanelOpen ? (
          <CardSchemaPanel boardId={boardId} socket={socket} onClose={handleCloseSchemaPanel} />
        ) : null}
        {openCardId ? (
          <CardDrawer
            cardId={openCardId}
            socket={socket}
            chatFacts={chatFacts}
            cardFields={view.board.cardFields}
            boardCards={blockerCandidates}
            onClose={handleCloseCard}
          />
        ) : null}
        <KannaBoard
          view={view}
          chatFacts={chatFacts}
          onCardMove={handleCardMove}
          onColumnMove={handleColumnMove}
          onOpenCard={handleOpenCard}
          onLoadMore={handleLoadMore}
          onColumnSave={handleColumnSave}
          onColumnDelete={handleColumnDelete}
          onColumnAdd={handleColumnAdd}
          onCardAdd={handleCardAdd}
          onMoveToTop={handleMoveToTop}
        />
      </div>
    </div>
  )
}
