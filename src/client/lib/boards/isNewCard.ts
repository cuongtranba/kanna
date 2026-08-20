import type { Card } from "../../../shared/boards/types"

export function isNewCard(card: Card, newSince: number | null): boolean {
  return newSince !== null && card.createdAt > newSince
}

export function countNewCards(cards: readonly Card[], newSince: number | null): number {
  if (newSince === null) return 0
  return cards.filter((c) => isNewCard(c, newSince)).length
}
