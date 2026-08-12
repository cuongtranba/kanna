import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { MessageSquare } from "lucide-react"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element"
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { cn } from "../../lib/utils"
import { chatDotBgClass, chatDotTextClass } from "../../lib/chatStatusIndicator"
import { formatLiveDuration } from "../../lib/formatDuration"
import { useNow } from "../../hooks/useNow"
import { cardChatSignal, type CardChatFacts } from "../../lib/boards/cardChatSignal"
import { COLUMN_DOT_CLASS, isOverWipLimit } from "../../lib/boards/columnStyle"
import {
  dropTargetForCardEdge,
  dropTargetForColumnEdge,
  resolveCardDrop,
  resolveColumnDrop,
  type CardMoveRequest,
} from "../../lib/boards/dnd"
import { selectDropAtColumnEnd, selectDropBeforeCard, useBoardDragStore } from "./BoardDrag.store"
import { ColumnSettings, type ColumnSettingsValue } from "./ColumnSettings"
import { useColumnAdderStore } from "./ColumnAdder.store"
import { selectCardDraft, useCardAdderStore } from "./CardAdder.store"
import type { BoardColumn, BoardViewSnapshot, Card } from "../../../shared/boards/types"

/**
 * The board, drawn by us.
 *
 * This used to wrap `react-kanban-kit`, which supplied layout, drag-and-drop
 * and virtualization. The virtualization is why it is gone: virtua hides an
 * item until a `ResizeObserver` measures it, and an item measured at zero size
 * while the pane was still laying out stayed hidden forever — a real card,
 * invisible, on the one surface where the cards ARE the product. The library's
 * own engine, `@atlaskit/pragmatic-drag-and-drop`, is used directly here
 * instead; it is what the package wrapped, so this is a layer removed rather
 * than a dependency swapped.
 *
 * Nothing is virtualized now, and nothing needs to be: a column renders at most
 * one page of cards (30, raised on demand, capped server-side), so the DOM is
 * bounded by the paging contract rather than by the size of the board.
 *
 * Design rules this encodes (docs/kanban-boards-design-brief.md):
 *  - a column at rest is NOT a tinted panel; it is the page with a 1px divider,
 *  - a column's colour is a 6px dot, never a background wash,
 *  - the drop target shows a 1px line only WHILE dragging,
 *  - a healthy card shows no badges; silence is the healthy state.
 */

export type { CardMoveRequest }

export interface KannaBoardProps {
  view: BoardViewSnapshot
  /**
   * Live facts for every chat the workspace knows about, keyed by chat id.
   * Optional: a board mounted for its layout alone still renders, and its cards
   * then simply say nothing — which is what a healthy card says anyway.
   */
  chatFacts?: Readonly<Record<string, CardChatFacts>>
  onCardMove: (move: CardMoveRequest) => void
  onColumnMove: (columnId: string, afterColumnId: string | null) => void
  onOpenCard: (cardId: string) => void
  onLoadMore: (columnId: string) => void
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
  onColumnAdd: (title: string) => void
  onCardAdd: (columnId: string, title: string) => void
}

/** Data keys marking what a drag is carrying, so a card cannot drop as a column. */
const CARD = "kanna-board-card"
const COLUMN = "kanna-board-column"

/**
 * The current columns, readable from a drag callback.
 *
 * Drag listeners are registered once per element; closing over the snapshot
 * would pin them to whatever the board looked like when the listener was
 * attached. A module-level ref keeps them current without re-registering every
 * listener on every board update. One board is open per pane, and a drag is
 * global to the document, so a single slot cannot drift.
 */
const liveColumns: { current: readonly BoardColumn[] } = { current: [] }

export function KannaBoard(props: KannaBoardProps) {
  const { view, onCardMove, onColumnMove } = props
  const boardRef = useRef<HTMLDivElement | null>(null)

  // Assigned in a layout effect, never during render: a drag listener is
  // registered once per element and must read the CURRENT board, but writing a
  // ref while rendering is what `react-hooks/refs` forbids.
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
    liveColumns.current = view.columns
  })

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

  // Horizontal auto-scroll when a drag reaches the board's edge.
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
      {view.columns.map((column) => (
        <BoardColumnView
          key={column.id}
          column={column}
          cards={view.cards[column.id] ?? EMPTY_CARDS}
          total={view.counts[column.id] ?? (view.cards[column.id] ?? EMPTY_CARDS).length}
          chatLinksByCard={view.chatLinksByCard ?? EMPTY_CHAT_LINKS}
          chatFacts={props.chatFacts ?? EMPTY_CHAT_FACTS}
          onCardDrop={handleCardDrop}
          onColumnDrop={handleColumnDrop}
          onOpenCard={props.onOpenCard}
          onLoadMore={props.onLoadMore}
          onColumnSave={props.onColumnSave}
          onColumnDelete={props.onColumnDelete}
          onCardAdd={props.onCardAdd}
        />
      ))}
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
  chatLinksByCard: Readonly<Record<string, string[]>>
  chatFacts: Readonly<Record<string, CardChatFacts>>
  onCardDrop: (cardId: string) => void
  onColumnDrop: (columnId: string) => void
  onOpenCard: (cardId: string) => void
  onLoadMore: (columnId: string) => void
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
  onCardAdd: (columnId: string, title: string) => void
}

function BoardColumnView({
  column,
  cards,
  total,
  chatLinksByCard,
  chatFacts,
  onOpenCard,
  onLoadMore,
  onColumnSave,
  onColumnDelete,
  onCardAdd,
  onCardDrop,
  onColumnDrop,
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
    // The header is the handle: dragging from the card area must move a card,
    // not the column it sits in.
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
        // The list is the fallback target: an empty column, or the space under
        // the last card, both mean "put it at the end". A card hovered inside
        // it overrides this with its own edge.
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
        {/* tabular-nums so a live count cannot reflow the header. */}
        <span
          className={cn(
            "ml-auto font-mono text-xs tabular-nums",
            overLimit ? "text-warning" : "text-muted-foreground",
          )}
        >
          {total}
        </span>
        <ColumnSettings
          columnId={columnId}
          value={settings}
          canDelete={total === 0}
          onSave={onColumnSave}
          onDelete={onColumnDelete}
        />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-2">
        {cards.map((card) => (
          <BoardCard
            key={card.id}
            card={card}
            columnId={columnId}
            cards={cards}
            chatIds={chatLinksByCard[card.id] ?? EMPTY_CHAT_IDS}
            chatFacts={chatFacts}
            onOpen={onOpenCard}
            onCardDrop={onCardDrop}
          />
        ))}
        {dropAtEnd ? <CardDropLine /> : null}
        {total > cards.length ? <MoreCards columnId={columnId} onLoadMore={onLoadMore} /> : null}
      </div>

      <CardAdder columnId={columnId} onAdd={onCardAdd} />
    </div>
  )
}

function applyColumnEdge(data: Record<string | symbol, unknown>, hoveredColumnId: string) {
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
  onOpen,
  onCardDrop,
}: {
  card: Card
  columnId: string
  cards: readonly Card[]
  chatIds: readonly string[]
  chatFacts: Readonly<Record<string, CardChatFacts>>
  onOpen: (cardId: string) => void
  onCardDrop: (cardId: string) => void
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

  // Liveness, not attribution. `card.updatedBy.kind === "agent"` — what this row
  // used to key on — says an agent wrote the row last, so a card finished an
  // hour ago looked identical to one mid-turn.
  const signal = cardChatSignal(chatIds, chatFacts)

  return (
    <div ref={ref} className="relative">
      {dropBefore ? <CardDropLine /> : null}
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          // Flat by default: 1px edge, no shadow, no left stripe.
          "w-full cursor-grab rounded-lg border border-border bg-card px-3 py-2 text-left",
          "transition-colors duration-150 hover:bg-secondary",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          dragging && "opacity-40",
        )}
      >
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground [text-wrap:pretty]">
          {card.title}
        </span>
        {signal ? (
          // Only rendered when there is something to say. A healthy card is silent.
          <span
            className={cn(
              "mt-1.5 flex items-center gap-1.5 text-xs",
              chatDotTextClass(signal.tone),
            )}
          >
            {signal.tone ? (
              // A resting dot: no pulse, no glow. The label beside it is what
              // carries the meaning — the colour only sharpens it.
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", chatDotBgClass(signal.tone))}
              />
            ) : (
              <MessageSquare aria-hidden className="size-3 shrink-0" />
            )}
            <span>{signal.label}</span>
            {signal.liveSince === null ? null : <LiveStamp since={signal.liveSince} />}
          </span>
        ) : null}
      </button>
    </div>
  )
}

/**
 * The one thing on the board that ticks.
 *
 * Its own component so the second hand re-renders a stamp rather than the
 * board: a card is silent unless its chat is live, so at most a handful of
 * these exist at once, and the other 200 cards never re-render for the clock.
 */
function LiveStamp({ since }: { since: number }) {
  const now = useNow(1_000)
  return <span className="tabular-nums">{formatLiveDuration(Math.max(0, now - since))}</span>
}

function applyCardEdge(
  data: Record<string | symbol, unknown>,
  columnId: string,
  hoveredCardId: string,
  cards: readonly Card[],
) {
  const edge = extractClosestEdge(data)
  if (edge !== "top" && edge !== "bottom") return
  const beforeCardId = dropTargetForCardEdge(cards, hoveredCardId, edge)
  useBoardDragStore.getState().setCardDrop({ columnId, beforeCardId })
}

/** 1px line, only while dragging. Depth is a state response, not a resting style. */
function CardDropLine() {
  return <div aria-hidden className="pointer-events-none h-px w-full rounded-full bg-primary" />
}

function ColumnDropLine() {
  return <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary" />
}

/**
 * The tail of a partly-loaded column: honest about what is missing, and the
 * thing that asks for the next page when it scrolls into view.
 */
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
      {/* `animate-pulse` is sanctioned for skeletons. */}
      <div className="h-14 w-full animate-pulse rounded-lg border border-border bg-secondary" />
      <div className="h-14 w-full animate-pulse rounded-lg border border-border bg-secondary" />
    </div>
  )
}

/**
 * Adding a card is one field at the foot of its column.
 *
 * Not a dialog and not a button that opens one: a card is a title, and
 * everything else about it is edited in the drawer afterwards. Typing where the
 * card will appear is the shortest path between intent and result.
 */
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

/**
 * Adding a column is one field, not a dialog: a column is a name, and the role
 * and colour are set afterwards from the same popover that edits every other
 * column.
 */
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
      {/* An empty board teaches HERE, beside the field that acts on it. Copy
          that says "add a column" while the field is somewhere else is worse
          than no copy. */}
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
