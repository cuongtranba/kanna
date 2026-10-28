import type { Card } from "../../../shared/boards/types"
import { cardLabels } from "../../../shared/boards/well-known-fields"

export interface CardFilter {
  text: string
  labels: readonly string[]
}

export function filterCards(cards: readonly Card[], filter: CardFilter): readonly Card[] {
  const text = filter.text.trim().toLowerCase()
  const labels = filter.labels
  if (!text && labels.length === 0) return cards
  return cards.filter((card) => {
    if (text && !card.title.toLowerCase().includes(text)) return false
    if (labels.length > 0) {
      const present = cardLabels(card.content)
      if (!labels.some((l) => present.includes(l))) return false
    }
    return true
  })
}
