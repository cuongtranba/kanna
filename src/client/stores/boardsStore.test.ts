import { beforeEach, describe, expect, test } from "bun:test"
import {
  BOARD_PAGE_STEP,
  selectBoardPageSize,
  useBoardsStore,
  type BoardsState,
} from "./boardsStore"
import type { BoardViewSnapshot } from "../../shared/boards/types"

function view(cursors: Record<string, string | null>): BoardViewSnapshot {
  return {
    board: {
      id: "board-1",
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
    columns: [],
    counts: {},
    cards: {},
    cursors,
  }
}

const state = (): BoardsState => useBoardsStore.getState()

beforeEach(() => {
  useBoardsStore.setState({ boardsByOwner: {}, viewByBoard: {}, pageSizeByBoard: {} })
})

describe("board paging", () => {
  test("a board starts at one page", () => {
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP)
  })

  test("growing asks for one more page per call", () => {
    state().setBoardView("board-1", view({ c1: "rank-30" }))
    state().growPage("board-1")
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP * 2)
    state().growPage("board-1")
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP * 3)
  })

  /**
   * A null cursor means the column delivered everything. Without this the
   * library's own loadMore at the end of a short column would climb the page
   * size to the server's cap for nothing.
   */
  test("an exhausted board stops growing", () => {
    state().setBoardView("board-1", view({ c1: null, c2: null }))
    const before = state()
    state().growPage("board-1")
    expect(state()).toBe(before)
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP)
  })

  test("one column with more to give keeps the board growing", () => {
    state().setBoardView("board-1", view({ c1: null, c2: "rank-30" }))
    state().growPage("board-1")
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP * 2)
  })

  /** A board with no snapshot yet must still be able to page. */
  test("growing before the first snapshot is allowed", () => {
    state().growPage("board-1")
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP * 2)
  })

  test("closing a board forgets how far it had paged", () => {
    state().setBoardView("board-1", view({ c1: "rank-30" }))
    state().growPage("board-1")
    state().clearBoardView("board-1")
    expect(selectBoardPageSize("board-1")(state())).toBe(BOARD_PAGE_STEP)
  })
})
