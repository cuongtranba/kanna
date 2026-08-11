import { describe, expect, test } from "bun:test"
import {
  BOARD_ROOT_ID,
  CARD_NODE_TYPE,
  COLUMN_DOT_CLASS,
  isOverWipLimit,
  readNodeContent,
  toBoardData,
} from "./toBoardData"
import { COLUMN_COLOR_TOKENS, type BoardViewSnapshot, type Card } from "../../../shared/boards/types"

function card(id: string, columnId: string, byAgent = false): Card {
  return {
    id,
    boardId: "b1",
    columnId,
    projectId: byAgent ? "p2" : null,
    title: `Card ${id}`,
    rank: "a0",
    content: {},
    updatedBy: byAgent ? { kind: "agent", chatId: "c1" } : { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

const VIEW: BoardViewSnapshot = {
  board: {
    id: "b1",
    ownerKind: "project",
    ownerId: "p1",
    title: "Sprint",
    description: null,
    templateId: null,
    cardFields: [],
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  },
  columns: [
    { id: "todo", boardId: "b1", title: "Todo", rank: "a0", semantic: "start", colorToken: "info", wipLimit: 2 },
    { id: "done", boardId: "b1", title: "Done", rank: "a1", semantic: "done", colorToken: null, wipLimit: null },
  ],
  // `todo` holds 40 cards but only 2 are loaded — the gap the library draws as skeletons.
  counts: { todo: 40, done: 0 },
  cards: { todo: [card("t1", "todo"), card("t2", "todo", true)], done: [] },
  cursors: { todo: "a1", done: null },
}

describe("toBoardData", () => {
  test("builds a root whose children are the columns in order", () => {
    const data = toBoardData(VIEW)
    expect(data[BOARD_ROOT_ID]?.children).toEqual(["todo", "done"])
    expect(data[BOARD_ROOT_ID]?.parentId).toBeNull()
    expect(data[BOARD_ROOT_ID]?.title).toBe("Sprint")
  })

  test("a column reports the REAL total, not the loaded count", () => {
    // This difference is the whole paging contract: the library renders the gap
    // as skeletons and calls loadMore. Collapsing them silently disables paging.
    const data = toBoardData(VIEW)
    expect(data.todo?.children).toEqual(["t1", "t2"])
    expect(data.todo?.totalChildrenCount).toBe(40)
  })

  test("falls back to the loaded count when no total was sent", () => {
    const data = toBoardData({ ...VIEW, counts: {} })
    expect(data.todo?.totalChildrenCount).toBe(2)
  })

  test("an empty column still gets a node", () => {
    const data = toBoardData(VIEW)
    expect(data.done?.children).toEqual([])
    expect(data.done?.totalChildrenCount).toBe(0)
  })

  test("cards are siblings parented to their column and typed for configMap", () => {
    const data = toBoardData(VIEW)
    expect(data.t1?.parentId).toBe("todo")
    expect(data.t1?.type).toBe(CARD_NODE_TYPE)
    expect(data.t1?.children).toEqual([])
  })

  test("agent authorship rides through to the card node", () => {
    const data = toBoardData(VIEW)
    expect(readNodeContent(data.t2!).updatedByAgent).toBe(true)
    expect(readNodeContent(data.t1!).updatedByAgent).toBe(false)
    expect(readNodeContent(data.t2!).projectId).toBe("p2")
  })

  test("column colour and WIP limit ride through", () => {
    const data = toBoardData(VIEW)
    expect(readNodeContent(data.todo!).colorToken).toBe("info")
    expect(readNodeContent(data.todo!).wipLimit).toBe(2)
    expect(readNodeContent(data.done!).colorToken).toBeNull()
  })

  test("a column with no cards loaded does not leak into another column", () => {
    const data = toBoardData(VIEW)
    const cardIds = Object.values(data).filter((node) => node.type === CARD_NODE_TYPE).map((node) => node.id)
    expect(cardIds.sort()).toEqual(["t1", "t2"])
  })
})

describe("readNodeContent", () => {
  test("returns empty content for a node that carries none", () => {
    expect(readNodeContent({ id: "x", title: "x", parentId: null, children: [], totalChildrenCount: 0 })).toEqual({
      colorToken: null,
      semantic: null,
      wipLimit: null,
      updatedByAgent: false,
      projectId: null,
    })
  })

  test("drops a colour token outside the closed set", () => {
    const node = {
      id: "x",
      title: "x",
      parentId: null,
      children: [],
      totalChildrenCount: 0,
      content: {
        colorToken: "hotpink",
        semantic: "shipped",
        wipLimit: "three",
        updatedByAgent: "yes",
        projectId: 7,
      },
    }
    expect(readNodeContent(node)).toEqual({
      colorToken: null,
      semantic: null,
      wipLimit: null,
      updatedByAgent: false,
      projectId: null,
    })
  })
})

describe("COLUMN_DOT_CLASS", () => {
  test("covers every colour token, with literal class names Tailwind can see", () => {
    // An interpolated `bg-${token}` is never emitted by Tailwind's scanner, so
    // the dot would render transparent. This asserts the lookup stays complete.
    for (const token of COLUMN_COLOR_TOKENS) {
      expect(COLUMN_DOT_CLASS[token]).toBe(`bg-${token}`)
    }
    expect(Object.keys(COLUMN_DOT_CLASS).sort()).toEqual([...COLUMN_COLOR_TOKENS].sort())
  })
})

describe("isOverWipLimit", () => {
  test("is false without a limit, and only true above it", () => {
    expect(isOverWipLimit(99, null)).toBe(false)
    expect(isOverWipLimit(2, 2)).toBe(false)
    expect(isOverWipLimit(3, 2)).toBe(true)
  })
})
