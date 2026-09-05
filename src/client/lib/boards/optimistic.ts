
import type { BoardViewSnapshot, Card } from "../../../shared/boards/types"

export interface OptimisticMove {
  cardId: string
  toColumnId: string
  aboveCardId: string | null
  belowCardId: string | null
}

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

function insertionIndex(destination: readonly Card[], move: OptimisticMove): number {
  if (move.aboveCardId !== null) {
    const index = destination.findIndex((card) => card.id === move.aboveCardId)
    if (index !== -1) return index + 1
  }
  if (move.belowCardId !== null) {
    const index = destination.findIndex((card) => card.id === move.belowCardId)
    if (index !== -1) return index
  }
  return move.aboveCardId !== null ? destination.length : 0
}

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
