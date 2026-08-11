import { useCallback, useMemo } from "react"
import { Kanban } from "react-kanban-kit"
import { Bot } from "lucide-react"
import { cn } from "../../lib/utils"
import {
  CARD_NODE_TYPE,
  COLUMN_DOT_CLASS,
  isOverWipLimit,
  readNodeContent,
  toBoardData,
  type BoardItem,
} from "../../lib/boards/toBoardData"
import { resolveColumnMove } from "../../lib/boards/optimistic"
import { ColumnSettings, type ColumnSettingsValue } from "./ColumnSettings"
import { useColumnAdderStore } from "./ColumnAdder.store"
import { selectCardDraft, useCardAdderStore } from "./CardAdder.store"
import type { BoardViewSnapshot } from "../../../shared/boards/types"

/**
 * The only module that imports `react-kanban-kit` at RUNTIME (the mapper in
 * `lib/boards/toBoardData.ts` imports its types only).
 *
 * The library supplies layout, drag-and-drop (Atlassian pragmatic-dnd) and
 * virtualisation. Every visible element comes from the render props below, in
 * Kanna's own tokens — so the package contributes no pixels of its own and can
 * be swapped for its underlying dnd engine without touching anything else.
 *
 * Design rules this encodes (see docs/kanban-boards-design-brief.md):
 *  - a column at rest is NOT a tinted panel; it is the page with a 1px divider,
 *  - a column's colour is a 6px dot, never a background wash,
 *  - the drop target tints only WHILE dragging — depth is a state response,
 *  - a healthy card shows no badges; silence is the healthy state.
 */

export interface CardMoveRequest {
  cardId: string
  toColumnId: string
  aboveCardId: string | null
  belowCardId: string | null
}

export interface KannaBoardProps {
  view: BoardViewSnapshot
  onCardMove: (move: CardMoveRequest) => void
  onColumnMove: (columnId: string, afterColumnId: string | null) => void
  onOpenCard: (cardId: string) => void
  onLoadMore: (columnId: string) => void
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
  onColumnAdd: (title: string) => void
  onCardAdd: (columnId: string, title: string) => void
}

interface KanbanColumnMove {
  columnId: string
  fromIndex: number
  toIndex: number
}

interface KanbanMove {
  cardId: string
  fromColumnId: string
  toColumnId: string
  taskAbove: string | null
  taskBelow: string | null
  position: number
}

export function KannaBoard({
  view,
  onCardMove,
  onColumnMove,
  onOpenCard,
  onLoadMore,
  onColumnSave,
  onColumnDelete,
  onColumnAdd,
  onCardAdd,
}: KannaBoardProps) {
  const dataSource = useMemo(() => toBoardData(view), [view])
  const columnIds = useMemo(() => view.columns.map((column) => column.id), [view.columns])

  const handleColumnMove = useCallback(
    (move: KanbanColumnMove) => {
      // The library reports indices; the store takes a neighbour, so a rank
      // resolved under the write's own transaction cannot race another writer.
      const resolved = resolveColumnMove(columnIds, move.fromIndex, move.toIndex)
      if (resolved) onColumnMove(resolved.columnId, resolved.afterColumnId)
    },
    [columnIds, onColumnMove],
  )

  const handleCardMove = useCallback(
    (move: KanbanMove) => {
      onCardMove({
        cardId: move.cardId,
        toColumnId: move.toColumnId,
        aboveCardId: move.taskAbove ?? null,
        belowCardId: move.taskBelow ?? null,
      })
    },
    [onCardMove],
  )

  const configMap = useMemo(
    () => ({
      [CARD_NODE_TYPE]: {
        isDraggable: true,
        render: ({ data }: { data: BoardItem }) => <BoardCard node={data} onOpen={onOpenCard} />,
      },
    }),
    [onOpenCard],
  )

  const renderColumnHeader = useCallback(
    (column: BoardItem) => (
      <ColumnHeader
        column={column}
        onColumnSave={onColumnSave}
        onColumnDelete={onColumnDelete}
      />
    ),
    [onColumnDelete, onColumnSave],
  )

  const renderColumnAdder = useCallback(() => <ColumnAdder onAdd={onColumnAdd} />, [onColumnAdd])

  const renderListFooter = useCallback(
    (column: BoardItem) => <CardAdder columnId={column.id} onAdd={onCardAdd} />,
    [onCardAdd],
  )

  const renderSkeletonCard = useCallback(() => <CardSkeleton />, [])

  return (
    <div className="h-full w-full overflow-x-auto bg-background">
      <Kanban
        dataSource={dataSource}
        configMap={configMap}
        cardsGap={8}
        virtualization
        loadMore={onLoadMore}
        onCardMove={handleCardMove}
        onColumnMove={handleColumnMove}
        allowColumnDrag
        allowColumnAdder
        renderColumnAdder={renderColumnAdder}
        renderListFooter={renderListFooter}
        renderColumnHeader={renderColumnHeader}
        renderSkeletonCard={renderSkeletonCard}
        rootClassName="kanna-board flex h-full items-start gap-0 bg-background p-4"
        columnWrapperClassName={columnWrapperClassName}
        columnListContentClassName={columnListContentClassName}
      />
    </div>
  )
}

/**
 * Only the uncontested parts. Width and the 1px divider are set in
 * `src/index.css` under `.kanna-board .rkk-column-outer`, because the package
 * styles that class directly and a utility class ties with it on specificity.
 */
const COLUMN_WRAPPER_CLASS = "shrink-0 px-3"
const COLUMN_LIST_CLASS = "px-1 py-2"

// The library takes per-column callbacks, not strings. Hoisted so the props
// stay reference-stable across renders.
const columnWrapperClassName = () => COLUMN_WRAPPER_CLASS
const columnListContentClassName = () => COLUMN_LIST_CLASS

function ColumnHeader({
  column,
  onColumnSave,
  onColumnDelete,
}: {
  column: BoardItem
  onColumnSave: (columnId: string, patch: ColumnSettingsValue) => void
  onColumnDelete: (columnId: string) => void
}) {
  const { colorToken, semantic, wipLimit } = readNodeContent(column)
  const overLimit = isOverWipLimit(column.children.length, wipLimit)
  const settings = useMemo(
    () => ({ title: column.title, semantic, colorToken, wipLimit }),
    [colorToken, column.title, semantic, wipLimit],
  )
  return (
    <div className="flex items-center gap-2 px-1 pb-2 pt-1">
      {colorToken ? (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", COLUMN_DOT_CLASS[colorToken])} />
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
        {column.totalChildrenCount}
      </span>
      <ColumnSettings
        columnId={column.id}
        value={settings}
        canDelete={column.totalChildrenCount === 0}
        onSave={onColumnSave}
        onDelete={onColumnDelete}
      />
    </div>
  )
}

/**
 * Adding a card is one field at the foot of its column.
 *
 * Not a dialog, and not a button that opens one: a card is a title, and
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
    <form onSubmit={handleSubmit} className="px-1 pb-2 pt-1">
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
function ColumnAdder({ onAdd }: { onAdd: (title: string) => void }) {
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
    <form onSubmit={handleSubmit} className="w-56 shrink-0 px-3 pt-1">
      <input
        value={draft}
        onChange={handleChange}
        placeholder="Add a column"
        aria-label="Add a column"
        className="w-full bg-transparent px-1 py-1 text-[0.9375rem] text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </form>
  )
}

function BoardCard({ node, onOpen }: { node: BoardItem; onOpen: (cardId: string) => void }) {
  const handleOpen = useCallback(() => onOpen(node.id), [node.id, onOpen])
  const byAgent = readNodeContent(node).updatedByAgent

  return (
    <button
      type="button"
      onClick={handleOpen}
      className={cn(
        // Flat by default: 1px edge, no shadow, no left stripe.
        "w-full rounded-lg border border-border bg-card px-3 py-2 text-left",
        "transition-colors duration-150 hover:bg-secondary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground [text-wrap:pretty]">
        {node.title}
      </span>
      {byAgent ? (
        // Only rendered when there is something to say. A healthy card is silent.
        <span className="mt-1.5 flex items-center gap-1 text-xs text-warning">
          <Bot aria-hidden className="size-3" />
          <span>Agent</span>
        </span>
      ) : null}
    </button>
  )
}

function CardSkeleton() {
  return (
    <div className="h-14 w-full animate-pulse rounded-lg border border-border bg-secondary" aria-hidden />
  )
}
