import type { Card } from "../../../shared/boards/types"

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
      const labelField = card.content.labels
      const cardLabels = labelField?.kind === "label" ? labelField.values : []
      if (!labels.some((l) => cardLabels.includes(l))) return false
    }
    return true
  })
}
