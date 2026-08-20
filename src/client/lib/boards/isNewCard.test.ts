import { describe, expect, test } from "bun:test"
import { countNewCards, isNewCard } from "./isNewCard"
import type { Card } from "../../../shared/boards/types"

function card(id: string, createdAt: number): Card {
  return {
    id,
    boardId: "b1",
    columnId: "col1",
    projectId: null,
    title: id,
    rank: "a0",
    content: {},
    updatedBy: { kind: "user" },
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  }
}

describe("isNewCard", () => {
  test("returns false when newSince is null", () => {
    expect(isNewCard(card("1", 1000), null)).toBe(false)
  })

  test("returns true when card was created after newSince", () => {
    expect(isNewCard(card("1", 1001), 1000)).toBe(true)
  })

  test("returns false when card was created exactly at newSince", () => {
    expect(isNewCard(card("1", 1000), 1000)).toBe(false)
  })

  test("returns false when card was created before newSince", () => {
    expect(isNewCard(card("1", 999), 1000)).toBe(false)
  })
})

describe("countNewCards", () => {
  const CARDS = [card("a", 500), card("b", 1001), card("c", 2000)]

  test("returns 0 when newSince is null", () => {
    expect(countNewCards(CARDS, null)).toBe(0)
  })

  test("counts cards created strictly after newSince", () => {
    expect(countNewCards(CARDS, 1000)).toBe(2)
  })

  test("returns 0 when no cards are new", () => {
    expect(countNewCards(CARDS, 9999)).toBe(0)
  })

  test("counts all cards when newSince is 0", () => {
    expect(countNewCards(CARDS, 0)).toBe(3)
  })
})
