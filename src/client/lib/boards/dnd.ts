/**
 * Turning a drop into a move the store will accept.
 *
 * Pragmatic drag-and-drop tells us WHERE the pointer let go — a target element
 * and which of its edges was closest. The board store takes neighbours instead:
 * "put this card between these two". Neighbours are what let the store resolve
 * a rank inside the same transaction as the write, so a drag cannot race
 * another writer the way a client-computed index would.
 *
 * This module is the whole translation, and it is pure: the drag machinery
 * decides nothing about ordering, and ordering can be tested without a pointer.
 */

import type { BoardColumn, BoardViewSnapshot } from "../../../shared/boards/types"

/** Where a drag currently wants to land: above a card, or at the end of a column. */
export interface CardDropTarget {
  columnId: string
  /** The card the indicator sits above; null means the end of the column. */
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
  /** The column it should follow; null means first. */
  afterColumnId: string | null
}

/**
 * The move a card drop means, or null when it means nothing.
 *
 * Null covers both the unknown target and — importantly — the drop that changes
 * nothing. Sending that would spend a round-trip and a broadcast to rewrite a
 * card's rank to the value it already had.
 */
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

/** The move a column drop means, or null when it means nothing. */
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

/**
 * Which card the drop indicator sits above, given the card hovered and the edge
 * the pointer is nearest.
 *
 * The bottom edge of a card means "after it", which is the same position as
 * "before the next one" — expressing both as `beforeCardId` keeps one shape for
 * the indicator and one for the resolver.
 */
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

/** The same, for columns: which column the vertical indicator sits before. */
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
