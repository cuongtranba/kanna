import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { motion } from "motion/react"
import { MessageSquare } from "lucide-react"
import { MOTION_SPRING } from "../../lib/motion"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element"
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { cn } from "../../lib/utils"
import { chatDotBgClass, chatDotTextClass } from "../../lib/chatStatusIndicator"
import { formatCountdown, formatLiveDuration } from "../../lib/formatDuration"
import { useNow } from "../../hooks/useNow"
import { cardWorkSignal, type CardChatFacts, type WorkClock } from "../../lib/boards/cardWorkSignal"
import { COLUMN_DOT_CLASS, isOverWipLimit } from "../../lib/boards/columnStyle"
import {
  dropTargetForCardEdge,
  dropTargetForColumnEdge,
  resolveCardDrop,
  resolveColumnDrop,
  type CardMoveRequest,
} from "../../lib/boards/dnd"
import { filterCards } from "../../lib/boards/filterCards"
import { isNewCard, countNewCards } from "../../lib/boards/isNewCard"
import { selectDropAtColumnEnd, selectDropBeforeCard, useBoardDragStore } from "./BoardDrag.store"
import { selectBoardFilter, useBoardFilterStore } from "./BoardFilter.store"
import { InboxFilterBar } from "./InboxFilterBar"
import { ColumnSettings, type ColumnSettingsValue } from "./ColumnSettings"
import { useColumnAdderStore } from "./ColumnAdder.store"
import { selectCardDraft, useCardAdderStore } from "./CardAdder.store"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu"
import type { BoardColumn, BoardViewSnapshot, Card } from "../../../shared/boards/types"


export type { CardMoveRequest }

export interface KannaBoardProps {
  view: BoardViewSnapshot
  chatFacts?: Readonly<Record<string, CardChatFacts>>
  onCardMove: (move: CardMoveRequest) => void
  onColumnMove: (columnId: string, afterColumnId: string | null) => void
  onOpenCard: (cardId: string) => void
  onLoadMore: (columnId: string) => void
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
  onColumnAdd: (title: string) => void
  onCardAdd: (columnId: string, title: string) => void
  onMoveToTop: (cardId: string) => void
}

const CARD = "kanna-board-card"
const COLUMN = "kanna-board-column"

const liveColumns: { current: readonly BoardColumn[] } = { current: [] }

export function KannaBoard(props: KannaBoardProps) {
  const { view, onCardMove, onColumnMove } = props
  const boardRef = useRef<HTMLDivElement | null>(null)

  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
    liveColumns.current = view.columns
  })

  const boardId = view.board.id
  const filter = useBoardFilterStore(selectBoardFilter(boardId))

  const handleCardDrop = useCallback(
    (cardId: string) => {
      const target = useBoardDragStore.getState().cardDrop
      useBoardDragStore.getState().endDrag()
      if (!target) return
      const move = resolveCardDrop(viewRef.current, cardId, target)
      if (move) onCardMove(move)
    },
    [onCardMove],
  )

  const handleColumnDrop = useCallback(
    (columnId: string) => {
      const { columnDropBeforeId, columnDropActive } = useBoardDragStore.getState()
      useBoardDragStore.getState().endDrag()
      if (!columnDropActive) return
      const move = resolveColumnDrop(viewRef.current.columns, columnId, columnDropBeforeId)
      if (move) onColumnMove(move.columnId, move.afterColumnId)
    },
    [onColumnMove],
  )

  useEffect(() => {
    const element = boardRef.current
    if (!element) return
    return autoScrollForElements({ element })
  }, [])

  return (
    <div
      ref={boardRef}
      className="kanna-board flex h-full w-full items-stretch gap-0 overflow-x-auto bg-background p-4"
    >
      {view.columns.map((column) => {
        const allCards = view.cards[column.id] ?? EMPTY_CARDS
        const isStart = column.semantic === "start"
        const displayCards = isStart ? filterCards(allCards, filter) : allCards
        return (
          <BoardColumnView
            key={column.id}
            column={column}
            cards={displayCards}
            total={view.counts[column.id] ?? allCards.length}
            newSince={isStart ? (view.newSince ?? null) : null}
            chatLinksByCard={view.chatLinksByCard ?? EMPTY_CHAT_LINKS}
            chatFacts={props.chatFacts ?? EMPTY_CHAT_FACTS}
            onCardDrop={handleCardDrop}
            onColumnDrop={handleColumnDrop}
            onOpenCard={props.onOpenCard}
            onLoadMore={props.onLoadMore}
            onColumnSave={props.onColumnSave}
            onColumnDelete={props.onColumnDelete}
            onCardAdd={props.onCardAdd}
            onMoveToTop={props.onMoveToTop}
          />
        )
      })}
      <ColumnAdder onAdd={props.onColumnAdd} isFirst={view.columns.length === 0} />
    </div>
  )
}

const EMPTY_CARDS: readonly Card[] = []
const EMPTY_CHAT_IDS: readonly string[] = []
const EMPTY_CHAT_LINKS: Readonly<Record<string, string[]>> = {}
const EMPTY_CHAT_FACTS: Readonly<Record<string, CardChatFacts>> = {}

interface ColumnViewProps {
  column: BoardColumn
  cards: readonly Card[]
  total: number
  newSince: number | null
  chatLinksByCard: Readonly<Record<string, string[]>>
  chatFacts: Readonly<Record<string, CardChatFacts>>
  onCardDrop: (cardId: string) => void
  onColumnDrop: (columnId: string) => void
  onOpenCard: (cardId: string) => void
  onLoadMore: (columnId: string) => void
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
  onCardAdd: (columnId: string, title: string) => void
  onMoveToTop: (cardId: string) => void
}

function BoardColumnView({
  column,
  cards,
  total,
  newSince,
  chatLinksByCard,
  chatFacts,
  onOpenCard,
  onLoadMore,
  onColumnSave,
  onColumnDelete,
  onCardAdd,
  onCardDrop,
  onColumnDrop,
  onMoveToTop,
}: ColumnViewProps) {
  const outerRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const columnId = column.id

  const dragging = useBoardDragStore((state) => state.draggingColumnId === columnId)
  const dropBefore = useBoardDragStore(
    (state) => state.columnDropActive && state.columnDropBeforeId === columnId,
  )
  const dropAtEnd = useBoardDragStore(selectDropAtColumnEnd(columnId))

  useEffect(() => {
    const outer = outerRef.current
    const list = listRef.current
    if (!outer || !list) return
    const store = useBoardDragStore.getState()
    const handle = outer.querySelector<HTMLElement>("[data-column-handle]") ?? undefined

    return combine(
      draggable({
        element: outer,
        dragHandle: handle,
        getInitialData: () => ({ [COLUMN]: true, columnId }),
        onDragStart: () => { store.startColumnDrag(columnId) },
        onDrop: () => { onColumnDrop(columnId) },
      }),
      dropTargetForElements({
        element: outer,
        canDrop: ({ source }) => source.data[COLUMN] === true,
        getData: ({ input, element }) =>
          attachClosestEdge({ columnId }, { input, element, allowedEdges: ["left", "right"] }),
        onDragEnter: ({ self }) => { applyColumnEdge(self.data, columnId) },
        onDrag: ({ self }) => { applyColumnEdge(self.data, columnId) },
      }),
      dropTargetForElements({
        element: list,
        canDrop: ({ source }) => source.data[CARD] === true,
        getData: () => ({ columnId }),
        onDragEnter: () => { store.setCardDrop({ columnId, beforeCardId: null }) },
        onDragLeave: () => { store.setCardDrop(null) },
      }),
      autoScrollForElements({ element: list }),
    )
  }, [columnId, onColumnDrop])

  const overLimit = isOverWipLimit(total, column.wipLimit)
  const settings = useMemo(
    () => ({
      title: column.title,
      semantic: column.semantic,
      colorToken: column.colorToken,
      wipLimit: column.wipLimit,
    }),
    [column.colorToken, column.semantic, column.title, column.wipLimit],
  )

  const isStart = column.semantic === "start"
  const newCount = newSince !== null ? countNewCards(cards, newSince) : 0

  return (
    <div
      ref={outerRef}
      className={cn(
        "relative flex h-full w-[300px] shrink-0 flex-col border-r border-border px-3",
        dragging && "opacity-40",
      )}
    >
      {dropBefore ? <ColumnDropLine /> : null}

      <div data-column-handle className="flex cursor-grab items-center gap-2 px-1 pb-2 pt-1">
        {column.colorToken ? (
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", COLUMN_DOT_CLASS[column.colorToken])}
          />
        ) : null}
        <span className="truncate text-[0.9375rem] font-semibold leading-tight text-foreground">
          {column.title}
        </span>
        <span
          className={cn(
            "ml-auto font-mono text-xs tabular-nums",
            overLimit ? "text-warning-text" : "text-muted-foreground",
          )}
        >
          {isStart && newCount > 0 ? (
            <>
              {total}
              <span className="text-info-text"> · {newCount} new</span>
            </>
          ) : (
            total
          )}
        </span>
        <ColumnSettings
          columnId={columnId}
          value={settings}
          canDelete={total === 0}
          onSave={onColumnSave}
          onDelete={onColumnDelete}
        />
      </div>

      {isStart ? <InboxFilterBar boardId={column.boardId} /> : null}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-2">
        {cards.map((card) => (
          <BoardCard
            key={card.id}
            card={card}
            columnId={columnId}
            cards={cards}
            chatIds={chatLinksByCard[card.id] ?? EMPTY_CHAT_IDS}
            chatFacts={chatFacts}
            newSince={newSince}
            onOpen={onOpenCard}
            onCardDrop={onCardDrop}
            onMoveToTop={onMoveToTop}
          />
        ))}
        {dropAtEnd ? <CardDropLine /> : null}
        {total > cards.length ? <MoreCards columnId={columnId} onLoadMore={onLoadMore} /> : null}
      </div>

      <CardAdder columnId={columnId} onAdd={onCardAdd} />
    </div>
  )
}

type DropTargetData = Parameters<typeof extractClosestEdge>[0]

function applyColumnEdge(data: DropTargetData, hoveredColumnId: string) {
  const edge = extractClosestEdge(data)
  if (edge !== "left" && edge !== "right") return
  const before = dropTargetForColumnEdge(liveColumns.current, hoveredColumnId, edge)
  useBoardDragStore.getState().setColumnDrop(before, true)
}

function BoardCard({
  card,
  columnId,
  cards,
  chatIds,
  chatFacts,
  newSince,
  onOpen,
  onCardDrop,
  onMoveToTop,
}: {
  card: Card
  columnId: string
  cards: readonly Card[]
  chatIds: readonly string[]
  chatFacts: Readonly<Record<string, CardChatFacts>>
  newSince: number | null
  onOpen: (cardId: string) => void
  onCardDrop: (cardId: string) => void
  onMoveToTop: (cardId: string) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const cardId = card.id
  const dragging = useBoardDragStore((state) => state.draggingCardId === cardId)
  const dropBefore = useBoardDragStore(selectDropBeforeCard(columnId, cardId))

  const cardsRef = useRef(cards)
  useLayoutEffect(() => {
    cardsRef.current = cards
  })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const store = useBoardDragStore.getState()

    return combine(
      draggable({
        element,
        getInitialData: () => ({ [CARD]: true, cardId }),
        onDragStart: () => { store.startCardDrag(cardId) },
        onDrop: () => { onCardDrop(cardId) },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data[CARD] === true,
        getData: ({ input, element: target }) =>
          attachClosestEdge({ cardId }, { input, element: target, allowedEdges: ["top", "bottom"] }),
        onDragEnter: ({ self }) => { applyCardEdge(self.data, columnId, cardId, cardsRef.current) },
        onDrag: ({ self }) => { applyCardEdge(self.data, columnId, cardId, cardsRef.current) },
      }),
    )
  }, [cardId, columnId, onCardDrop])

  const handleOpen = useCallback(() => { onOpen(cardId) }, [cardId, onOpen])
  const handleMoveToTop = useCallback(() => { onMoveToTop(cardId) }, [cardId, onMoveToTop])

  const signal = cardWorkSignal(chatIds, chatFacts)
  const isNew = isNewCard(card, newSince)

  return (
    <motion.div
      ref={ref}
      layout
      transition={{ type: "spring", ...MOTION_SPRING.cardTravel }}
      className="relative"
    >
      {dropBefore ? <CardDropLine /> : null}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleOpen}
            className={cn(
              "w-full cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-left",
              "transition-[colors,transform,opacity] duration-[var(--motion-quick)] hover:bg-secondary",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              dragging && "scale-[1.02] opacity-40",
            )}
          >
            <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground [text-wrap:pretty]">
              {card.title}
            </span>
            {isNew ? (
              <span className="mt-1 flex items-center gap-1 text-xs text-info-text">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-info" />
                <span>New</span>
              </span>
            ) : null}
            {signal ? (
              <span
                className={cn(
                  "mt-1.5 flex items-center gap-1.5 text-xs",
                  chatDotTextClass(signal.tone),
                )}
              >
                {signal.tone ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", chatDotBgClass(signal.tone))}
                  />
                ) : (
                  <MessageSquare aria-hidden className="size-3 shrink-0" />
                )}
                <span>{signal.label}</span>
                {signal.clock === null ? null : <LiveStamp clock={signal.clock} />}
              </span>
            ) : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleMoveToTop}>Move to top</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </motion.div>
  )
}

function LiveStamp({ clock }: { clock: WorkClock }) {
  const now = useNow(1_000)
  const text = clock.kind === "elapsed"
    ? formatLiveDuration(Math.max(0, now - clock.since))
    : formatCountdown(clock.until - now)
  return <span className="tabular-nums">{text}</span>
}

function applyCardEdge(
  data: DropTargetData,
  columnId: string,
  hoveredCardId: string,
  cards: readonly Card[],
) {
  const edge = extractClosestEdge(data)
  if (edge !== "top" && edge !== "bottom") return
  const beforeCardId = dropTargetForCardEdge(cards, hoveredCardId, edge)
  useBoardDragStore.getState().setCardDrop({ columnId, beforeCardId })
}

function CardDropLine() {
  return (
    <div
      aria-hidden
      className="pointer-events-none h-px w-full origin-left rounded-full bg-primary kanna-drop-line-in"
    />
  )
}

function ColumnDropLine() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 w-px origin-top bg-primary kanna-column-drop-line-in"
    />
  )
}

function MoreCards({
  columnId,
  onLoadMore,
}: {
  columnId: string
  onLoadMore: (columnId: string) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore(columnId)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [columnId, onLoadMore])

  return (
    <div ref={ref} className="space-y-2" aria-hidden>
      <div className="h-14 w-full animate-pulse rounded-lg border border-border bg-secondary" />
      <div className="h-14 w-full animate-pulse rounded-lg border border-border bg-secondary" />
    </div>
  )
}

function CardAdder({
  columnId,
  onAdd,
}: {
  columnId: string
  onAdd: (columnId: string, title: string) => void
}) {
  const draft = useCardAdderStore(selectCardDraft(columnId))

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      useCardAdderStore.getState().setDraft(columnId, event.currentTarget.value)
    },
    [columnId],
  )

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const title = (useCardAdderStore.getState().draftByColumn[columnId] ?? "").trim()
      if (title === "") return
      useCardAdderStore.getState().clear(columnId)
      onAdd(columnId, title)
    },
    [columnId, onAdd],
  )

  return (
    <form onSubmit={handleSubmit} className="shrink-0 px-1 pb-1 pt-2">
      <input
        value={draft}
        onChange={handleChange}
        placeholder="Add a card"
        aria-label="Add a card"
        className="w-full rounded-md bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground hover:bg-secondary focus:bg-secondary focus:outline-none"
      />
    </form>
  )
}

function ColumnAdder({ onAdd, isFirst }: { onAdd: (title: string) => void; isFirst: boolean }) {
  const draft = useColumnAdderStore((state) => state.draft)

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useColumnAdderStore.getState().setDraft(event.currentTarget.value)
  }, [])

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const title = useColumnAdderStore.getState().draft.trim()
      if (title === "") return
      useColumnAdderStore.getState().clear()
      onAdd(title)
    },
    [onAdd],
  )

  return (
    <form onSubmit={handleSubmit} className="w-64 shrink-0 px-3 pt-1">
      {isFirst ? (
        <p className="mb-2 px-1 text-sm text-muted-foreground [text-wrap:pretty]">
          No columns yet. Name your first one to start tracking work your agents can pick up.
        </p>
      ) : null}
      <input
        value={draft}
        onChange={handleChange}
        placeholder={isFirst ? "Name your first column" : "Add a column"}
        aria-label="Add a column"
        className="w-full rounded-md bg-transparent px-1 py-1 text-[0.9375rem] text-foreground placeholder:text-muted-foreground hover:bg-secondary focus:bg-secondary focus:outline-none"
      />
    </form>
  )
}
