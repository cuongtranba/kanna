import { describe, expect, test } from "bun:test"
import { moveCardInView, type OptimisticMove } from "./optimistic"
import type { BoardViewSnapshot, Card } from "../../../shared/boards/types"

function card(id: string, columnId: string, rank: string): Card {
  return {
    id,
    boardId: "b1",
    columnId,
    projectId: null,
    title: id,
    rank,
    content: {},
    updatedBy: { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

function view(): BoardViewSnapshot {
  return {
    board: {
      id: "b1",
      ownerKind: "project",
      ownerId: "p1",
      title: "Board",
      description: null,
      templateId: null,
      cardFields: [],
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    },
    columns: [
      { id: "todo", boardId: "b1", title: "Todo", rank: "a0", semantic: "start", colorToken: null, wipLimit: null },
      { id: "doing", boardId: "b1", title: "Doing", rank: "a1", semantic: "active", colorToken: null, wipLimit: null },
    ],
    counts: { todo: 3, doing: 1 },
    cards: {
      todo: [card("t1", "todo", "a0"), card("t2", "todo", "a1"), card("t3", "todo", "a2")],
      doing: [card("d1", "doing", "a0")],
    },
    cursors: { todo: null, doing: null },
  }
}

function ids(snapshot: BoardViewSnapshot, columnId: string): string[] {
  return (snapshot.cards[columnId] ?? []).map((entry) => entry.id)
}

const move = (partial: Partial<OptimisticMove> & { cardId: string; toColumnId: string }): OptimisticMove => ({
  aboveCardId: null,
  belowCardId: null,
  ...partial,
})

describe("moveCardInView", () => {
  test("moves a card to another column and re-parents it", () => {
    const next = moveCardInView(view(), move({ cardId: "t1", toColumnId: "doing" }))
    expect(ids(next, "todo")).toEqual(["t2", "t3"])
    expect(ids(next, "doing")).toEqual(["t1", "d1"])
    expect(next.cards.doing?.[0]?.columnId).toBe("doing")
  })

  test("keeps the counts the column headers render", () => {
    const next = moveCardInView(view(), move({ cardId: "t1", toColumnId: "doing" }))
    expect(next.counts).toEqual({ todo: 2, doing: 2 })
  })

  test("a move within one column leaves the counts alone", () => {
    const next = moveCardInView(view(), move({ cardId: "t3", toColumnId: "todo", aboveCardId: "t1" }))
    expect(ids(next, "todo")).toEqual(["t1", "t3", "t2"])
    expect(next.counts).toEqual({ todo: 3, doing: 1 })
  })

  test("lands below the card it was dropped under", () => {
    const next = moveCardInView(view(), move({ cardId: "d1", toColumnId: "todo", aboveCardId: "t2" }))
    expect(ids(next, "todo")).toEqual(["t1", "t2", "d1", "t3"])
  })

  test("lands above the card it was dropped over", () => {
    const next = moveCardInView(view(), move({ cardId: "d1", toColumnId: "todo", belowCardId: "t2" }))
    expect(ids(next, "todo")).toEqual(["t1", "d1", "t2", "t3"])
  })

  test("a drop with no neighbours goes to the top", () => {
    const next = moveCardInView(view(), move({ cardId: "d1", toColumnId: "todo" }))
    expect(ids(next, "todo")).toEqual(["d1", "t1", "t2", "t3"])
  })

  test("prefers the above anchor when both neighbours are reported", () => {
    // The two can disagree once the moved card is removed from the list, and
    // `above` is the one the user actually dropped beneath.
    const next = moveCardInView(view(), move({ cardId: "d1", toColumnId: "todo", aboveCardId: "t1", belowCardId: "t3" }))
    expect(ids(next, "todo")).toEqual(["t1", "d1", "t2", "t3"])
  })

  test("moving into an empty column works", () => {
    const base = view()
    base.cards.empty = []
    base.counts.empty = 0
    const next = moveCardInView(base, move({ cardId: "t1", toColumnId: "empty" }))
    expect(ids(next, "empty")).toEqual(["t1"])
    expect(next.counts.empty).toBe(1)
  })

  test("returns the view unchanged for an unknown card or column", () => {
    const base = view()
    // An optimistic update must never invent state; the server snapshot settles it.
    expect(moveCardInView(base, move({ cardId: "ghost", toColumnId: "doing" }))).toBe(base)
    expect(moveCardInView(base, move({ cardId: "t1", toColumnId: "nowhere" }))).toBe(base)
  })

  test("does not mutate the snapshot it was given", () => {
    const base = view()
    const before = JSON.stringify(base)
    moveCardInView(base, move({ cardId: "t1", toColumnId: "doing" }))
    expect(JSON.stringify(base)).toBe(before)
  })

  test("a stale neighbour degrades to a position rather than dropping the card", () => {
    const next = moveCardInView(view(), move({ cardId: "d1", toColumnId: "todo", aboveCardId: "deleted" }))
    expect(ids(next, "todo")).toHaveLength(4)
    expect(ids(next, "todo")).toContain("d1")
  })
})
