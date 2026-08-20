import { describe, expect, test } from "bun:test"
import { filterCards } from "./filterCards"
import type { Card } from "../../../shared/boards/types"

function card(id: string, title: string, labels: readonly string[] = []): Card {
  return {
    id,
    boardId: "b1",
    columnId: "col1",
    projectId: null,
    title,
    rank: "a0",
    content: labels.length > 0 ? { labels: { kind: "label", values: labels } } : {},
    updatedBy: { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

const CARDS = [
  card("1", "Fix the login bug", ["bug", "auth"]),
  card("2", "Add dark mode", ["enhancement"]),
  card("3", "Update README", ["docs"]),
  card("4", "Refactor auth module", ["auth", "refactor"]),
]

describe("filterCards", () => {
  test("returns all cards when filter is empty", () => {
    expect(filterCards(CARDS, { text: "", labels: [] })).toBe(CARDS)
  })

  test("filters by text case-insensitively", () => {
    const result = filterCards(CARDS, { text: "auth", labels: [] })
    expect(result.map((c) => c.id)).toEqual(["4"])
  })

  test("filters by text with leading/trailing whitespace", () => {
    const result = filterCards(CARDS, { text: "  readme  ", labels: [] })
    expect(result.map((c) => c.id)).toEqual(["3"])
  })

  test("returns empty when text matches nothing", () => {
    const result = filterCards(CARDS, { text: "zzz", labels: [] })
    expect(result).toHaveLength(0)
  })

  test("filters by a single label", () => {
    const result = filterCards(CARDS, { text: "", labels: ["bug"] })
    expect(result.map((c) => c.id)).toEqual(["1"])
  })

  test("filters by label using OR: a card matching any label passes", () => {
    const result = filterCards(CARDS, { text: "", labels: ["bug", "docs"] })
    expect(result.map((c) => c.id)).toEqual(["1", "3"])
  })

  test("filters by both text and label (AND)", () => {
    const result = filterCards(CARDS, { text: "auth", labels: ["refactor"] })
    expect(result.map((c) => c.id)).toEqual(["4"])
  })

  test("excludes cards with no label field when filtering by label", () => {
    const noLabelCard = card("5", "No labels here")
    const result = filterCards([...CARDS, noLabelCard], { text: "", labels: ["bug"] })
    expect(result.map((c) => c.id)).toEqual(["1"])
  })

  test("returns a stable reference when nothing is filtered", () => {
    const cards = [card("1", "hello")]
    const result = filterCards(cards, { text: "", labels: [] })
    expect(result).toBe(cards)
  })
})
