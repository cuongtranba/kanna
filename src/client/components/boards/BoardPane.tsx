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

const EMPTY_CANDIDATES: readonly BlockerCandidate[] = []

export interface BoardPaneProps {
  boardId: string
  socket: BoardPaneSocket
  /**
   * Live facts for every chat the workspace knows about, keyed by chat id —
   * prop-drilled rather than read from context so the board can be mounted
   * without the app's providers. Optional: absent, a card says nothing, which
   * is what a card with no live chat says anyway.
   */
  chatFacts?: Readonly<Record<string, BoardChatFacts>>
  onOpenCard?: (cardId: string) => void
  /**
   * Go to this board's project list. Takes the owner because the board's view
   * is the only place the pane learns which project it belongs to — the tab
   * carries a board id and nothing else.
   */
  onOpenBoards?: (projectId: string) => void
}

export function BoardPane({ boardId, socket, chatFacts, onOpenCard, onOpenBoards }: BoardPaneProps) {
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

  const schemaPanelOpen = useBoardSyncStore((state) => state.schemaPanelOpen)

  /**
   * The draft is seeded HERE, at the moment the panel opens, rather than by the
   * panel reading the board. A board broadcast arrives with a freshly decoded
   * `cardFields` array on every card move, so a panel that re-seeded from it
   * would lose an edit in progress the first time anyone dragged a card.
   */
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
          // The authoritative snapshot is the correction.
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

  // A stack board has no single project list to go back to, so it shows no
  // breadcrumb rather than a link that would have to pick one.
  const ownerProjectId =
    view && view.board.ownerKind === "project" && onOpenBoards ? view.board.ownerId : null

  const handleOpenBoards = useCallback(() => {
    if (ownerProjectId) onOpenBoards?.(ownerProjectId)
  }, [onOpenBoards, ownerProjectId])

  /**
   * Every card the board has actually shipped, in column order.
   *
   * Memoized because the drawer filters it on every render, and a fresh array
   * per board push would defeat that for no reason.
   */
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
      {/*
        A second-level bar, under the pane's tab strip — which already carries
        this board's identity and is how the reader moves to a chat. So it stays
        quieter than the strip above it: a breadcrumb back to the list, the name,
        and the two actions that belong to the board itself.
      */}
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
            // The card's detail does not carry the board's schema, and the
            // drawer needs it to know what a card even has.
            cardFields={view.board.cardFields}
            // Nor does it carry the board's other cards, which is what the
            // "Blocked by" picker offers.
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
