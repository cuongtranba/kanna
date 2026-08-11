import { describe, expect, test } from "bun:test"
import {
  dropTargetForCardEdge,
  dropTargetForColumnEdge,
  resolveCardDrop,
  resolveColumnDrop,
} from "./dnd"
import type { BoardColumn, BoardViewSnapshot, Card } from "../../../shared/boards/types"

function card(id: string, columnId: string): Card {
  return {
    id,
    boardId: "b1",
    columnId,
    projectId: null,
    title: id,
    rank: id,
    content: {},
    updatedBy: { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

function column(id: string): BoardColumn {
  return { id, boardId: "b1", title: id, rank: id, semantic: null, colorToken: null, wipLimit: null }
}

const COLUMNS = [column("c1"), column("c2")]

function view(): BoardViewSnapshot {
  return {
    board: {
      id: "b1",
      ownerKind: "project",
      ownerId: "p1",
      title: "B",
      description: null,
      templateId: null,
      cardFields: [],
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    },
    columns: COLUMNS,
    counts: { c1: 3, c2: 0 },
    cards: { c1: [card("a", "c1"), card("b", "c1"), card("c", "c1")], c2: [] },
    cursors: {},
  }
}

describe("resolveCardDrop", () => {
  test("names the neighbours the store orders between", () => {
    expect(resolveCardDrop(view(), "a", { columnId: "c1", beforeCardId: "c" })).toEqual({
      cardId: "a",
      toColumnId: "c1",
      aboveCardId: "b",
      belowCardId: "c",
    })
  })

  test("dropping at the end of a column has no card below it", () => {
    expect(resolveCardDrop(view(), "a", { columnId: "c1", beforeCardId: null })).toEqual({
      cardId: "a",
      toColumnId: "c1",
      aboveCardId: "c",
      belowCardId: null,
    })
  })

  test("an empty column takes the card with no neighbours at all", () => {
    expect(resolveCardDrop(view(), "a", { columnId: "c2", beforeCardId: null })).toEqual({
      cardId: "a",
      toColumnId: "c2",
      aboveCardId: null,
      belowCardId: null,
    })
  })

  /**
   * The dragged card is not its own neighbour: moving `b` to the top makes `a`
   * the card BELOW it, not the card above.
   */
  test("the card being moved is excluded from the neighbours", () => {
    expect(resolveCardDrop(view(), "b", { columnId: "c1", beforeCardId: "a" })).toEqual({
      cardId: "b",
      toColumnId: "c1",
      aboveCardId: null,
      belowCardId: "a",
    })
  })

  /**
   * Sending this would spend a round-trip and a broadcast rewriting a rank to
   * the value it already had.
   */
  test("a drop that changes nothing resolves to nothing", () => {
    // `b` already sits between `a` and `c`, so "drop before c" is where it is.
    expect(resolveCardDrop(view(), "b", { columnId: "c1", beforeCardId: "c" })).toBeNull()
    expect(resolveCardDrop(view(), "a", { columnId: "c1", beforeCardId: "b" })).toBeNull()
    expect(resolveCardDrop(view(), "c", { columnId: "c1", beforeCardId: null })).toBeNull()
    // Moving to a different column is never a no-op, even from the same slot.
    expect(resolveCardDrop(view(), "c", { columnId: "c2", beforeCardId: null })).not.toBeNull()
  })

  test("an unknown column or card resolves to nothing", () => {
    expect(resolveCardDrop(view(), "a", { columnId: "nope", beforeCardId: null })).toBeNull()
    expect(resolveCardDrop(view(), "a", { columnId: "c1", beforeCardId: "nope" })).toBeNull()
  })
})

describe("resolveColumnDrop", () => {
  const columns = [column("c1"), column("c2"), column("c3")]

  test("names the column it should follow", () => {
    expect(resolveColumnDrop(columns, "c1", null)).toEqual({ columnId: "c1", afterColumnId: "c3" })
    expect(resolveColumnDrop(columns, "c3", "c1")).toEqual({ columnId: "c3", afterColumnId: null })
    expect(resolveColumnDrop(columns, "c1", "c3")).toEqual({ columnId: "c1", afterColumnId: "c2" })
  })

  test("a drop that changes nothing resolves to nothing", () => {
    expect(resolveColumnDrop(columns, "c2", "c3")).toBeNull()
    expect(resolveColumnDrop(columns, "c1", "c2")).toBeNull()
    expect(resolveColumnDrop(columns, "nope", null)).toBeNull()
    expect(resolveColumnDrop(columns, "c1", "nope")).toBeNull()
  })
})

describe("edge to insertion point", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }]

  /** "After this card" and "before the next" are the same place, said once. */
  test("a bottom edge is the next card's top edge", () => {
    expect(dropTargetForCardEdge(cards, "a", "top")).toBe("a")
    expect(dropTargetForCardEdge(cards, "a", "bottom")).toBe("b")
    expect(dropTargetForCardEdge(cards, "c", "bottom")).toBeNull()
    expect(dropTargetForCardEdge(cards, "nope", "top")).toBeNull()
  })

  test("the same rule sideways, for columns", () => {
    const columns = [column("c1"), column("c2")]
    expect(dropTargetForColumnEdge(columns, "c1", "left")).toBe("c1")
    expect(dropTargetForColumnEdge(columns, "c1", "right")).toBe("c2")
    expect(dropTargetForColumnEdge(columns, "c2", "right")).toBeNull()
  })
})
