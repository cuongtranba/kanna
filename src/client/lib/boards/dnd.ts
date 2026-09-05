
import type { BoardColumn, BoardViewSnapshot } from "../../../shared/boards/types"

export interface CardDropTarget {
  columnId: string
  beforeCardId: string | null
}

export interface CardMoveRequest {
  cardId: string
  toColumnId: string
  aboveCardId: string | null
  belowCardId: string | null
}

export interface ColumnMoveRequest {
  columnId: string
  afterColumnId: string | null
}

export function resolveCardDrop(
  view: BoardViewSnapshot,
  cardId: string,
  target: CardDropTarget,
): CardMoveRequest | null {
  const destination = view.cards[target.columnId]
  if (!destination) return null

  const remaining = destination.filter((card) => card.id !== cardId)
  const index =
    target.beforeCardId === null
      ? remaining.length
      : remaining.findIndex((card) => card.id === target.beforeCardId)
  if (index < 0) return null

  const aboveCardId = remaining[index - 1]?.id ?? null
  const belowCardId = remaining[index]?.id ?? null

  const source = findCardColumn(view, cardId)
  if (source && source.columnId === target.columnId) {
    const currentAbove = source.cards[source.index - 1]?.id ?? null
    const currentBelow = source.cards[source.index + 1]?.id ?? null
    if (currentAbove === aboveCardId && currentBelow === belowCardId) return null
  }

  return { cardId, toColumnId: target.columnId, aboveCardId, belowCardId }
}

function findCardColumn(
  view: BoardViewSnapshot,
  cardId: string,
): { columnId: string; index: number; cards: BoardViewSnapshot["cards"][string] } | null {
  for (const [columnId, cards] of Object.entries(view.cards)) {
    const index = cards.findIndex((card) => card.id === cardId)
    if (index >= 0) return { columnId, index, cards }
  }
  return null
}

export function resolveColumnDrop(
  columns: readonly BoardColumn[],
  columnId: string,
  beforeColumnId: string | null,
): ColumnMoveRequest | null {
  const currentIndex = columns.findIndex((column) => column.id === columnId)
  if (currentIndex < 0) return null

  const remaining = columns.filter((column) => column.id !== columnId)
  const index =
    beforeColumnId === null ? remaining.length : remaining.findIndex((column) => column.id === beforeColumnId)
  if (index < 0) return null

  const afterColumnId = remaining[index - 1]?.id ?? null
  if ((columns[currentIndex - 1]?.id ?? null) === afterColumnId) return null

  return { columnId, afterColumnId }
}

export function dropTargetForCardEdge(
  cardsInColumn: readonly { id: string }[],
  hoveredCardId: string,
  edge: "top" | "bottom",
): string | null {
  const index = cardsInColumn.findIndex((card) => card.id === hoveredCardId)
  if (index < 0) return null
  if (edge === "top") return hoveredCardId
  return cardsInColumn[index + 1]?.id ?? null
}

export function dropTargetForColumnEdge(
  columns: readonly BoardColumn[],
  hoveredColumnId: string,
  edge: "left" | "right",
): string | null {
  const index = columns.findIndex((column) => column.id === hoveredColumnId)
  if (index < 0) return null
  if (edge === "left") return hoveredColumnId
  return columns[index + 1]?.id ?? null
}
