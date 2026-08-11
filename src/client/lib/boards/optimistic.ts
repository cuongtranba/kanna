/**
 * Optimistic board updates.
 *
 * A drag must land instantly; the server's authoritative snapshot arrives a
 * round-trip later. These functions apply the move to KANNA's own snapshot
 * shape rather than to the kanban library's projection — the library renders
 * our state, it does not hold it. Keeping the optimistic path on our shape is
 * what stops the library from creeping into the state layer, and it makes the
 * behaviour testable without mounting a component.
 *
 * Pure. The server remains the authority: when its snapshot lands it replaces
 * whatever this produced, so a rejected move self-corrects.
 */

import type { BoardViewSnapshot, Card } from "../../../shared/boards/types"

export interface OptimisticMove {
  cardId: string
  toColumnId: string
  aboveCardId: string | null
  belowCardId: string | null
}

/**
 * Move a card between (or within) columns.
 *
 * Returns the input unchanged when the card or destination is unknown — an
 * optimistic update must never invent state; the real snapshot will settle it.
 */
export function moveCardInView(view: BoardViewSnapshot, move: OptimisticMove): BoardViewSnapshot {
  const fromColumnId = findCardColumn(view, move.cardId)
  if (fromColumnId === null) return view
  if (!(move.toColumnId in view.cards)) return view

  const card = (view.cards[fromColumnId] ?? []).find((candidate) => candidate.id === move.cardId)
  if (!card) return view

  const cards: Record<string, Card[]> = { ...view.cards }
  cards[fromColumnId] = (cards[fromColumnId] ?? []).filter((candidate) => candidate.id !== move.cardId)

  const destination = move.toColumnId === fromColumnId
    ? [...(cards[fromColumnId] ?? [])]
    : [...(cards[move.toColumnId] ?? [])]

  destination.splice(insertionIndex(destination, move), 0, { ...card, columnId: move.toColumnId })
  cards[move.toColumnId] = destination

  const counts: Record<string, number> = { ...view.counts }
  if (move.toColumnId !== fromColumnId) {
    counts[fromColumnId] = Math.max(0, (counts[fromColumnId] ?? 1) - 1)
    counts[move.toColumnId] = (counts[move.toColumnId] ?? 0) + 1
  }

  return { ...view, cards, counts }
}

function findCardColumn(view: BoardViewSnapshot, cardId: string): string | null {
  for (const [columnId, cards] of Object.entries(view.cards)) {
    if (cards.some((card) => card.id === cardId)) return columnId
  }
  return null
}

/**
 * Where the card lands, from the neighbours the drop reported.
 *
 * `aboveCardId` wins when both are present: it is the anchor the user dropped
 * below, and the two can disagree once the card itself has been removed from
 * the list.
 */
function insertionIndex(destination: readonly Card[], move: OptimisticMove): number {
  if (move.aboveCardId !== null) {
    const index = destination.findIndex((card) => card.id === move.aboveCardId)
    if (index !== -1) return index + 1
  }
  if (move.belowCardId !== null) {
    const index = destination.findIndex((card) => card.id === move.belowCardId)
    if (index !== -1) return index
  }
  // No usable neighbour means the column was empty, or the drop was at the top.
  return move.aboveCardId !== null ? destination.length : 0
}

/**
 * Translate the kanban library's index-based column drop into the neighbour the
 * store wants.
 *
 * The library reports where a column landed; the store takes "the column it
 * should sit after", because a rank resolved from a neighbour under the write's
 * own transaction cannot race a concurrent writer the way a client-computed
 * index would. Returns null when the drop changes nothing.
 */
export function resolveColumnMove(
  orderedColumnIds: readonly string[],
  fromIndex: number,
  toIndex: number,
): { columnId: string; afterColumnId: string | null } | null {
  const columnId = orderedColumnIds[fromIndex]
  if (columnId === undefined || fromIndex === toIndex) return null
  const remaining = orderedColumnIds.filter((_, index) => index !== fromIndex)
  if (toIndex < 0 || toIndex > remaining.length) return null
  return { columnId, afterColumnId: remaining[toIndex - 1] ?? null }
}

/**
 * Reorder a column locally so the drop lands under the cursor.
 *
 * Returns the input unchanged when the column is unknown, on the same rule as
 * {@link moveCardInView}: an optimistic update never invents state.
 */
export function moveColumnInView(
  view: BoardViewSnapshot,
  columnId: string,
  afterColumnId: string | null,
): BoardViewSnapshot {
  const moving = view.columns.find((column) => column.id === columnId)
  if (!moving) return view
  if (afterColumnId !== null && !view.columns.some((column) => column.id === afterColumnId)) return view

  const remaining = view.columns.filter((column) => column.id !== columnId)
  const at = afterColumnId === null ? 0 : remaining.findIndex((column) => column.id === afterColumnId) + 1
  return { ...view, columns: [...remaining.slice(0, at), moving, ...remaining.slice(at)] }
}
