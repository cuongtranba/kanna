import { beforeEach, describe, expect, test } from "bun:test"
import { createBoardRegistry, DEFAULT_BOARD_PAGE_SIZE, type BoardChange, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import { BoardStoreError, type BoardOwnerRef, type BoardStore } from "./board-store"
import type { BoardTemplateDefinition, CardActor } from "../shared/boards/types"

const USER: CardActor = { kind: "user" }
const AGENT: CardActor = { kind: "agent", chatId: "chat-1" }

const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: "muted-icon", wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: "warning", wipLimit: null },
    { title: "Done", semantic: "done", colorToken: "success", wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

let store: BoardStore
let registry: BoardRegistry
let changes: BoardChange[]

function setup() {
  let counter = 0
  store = createBoardStore({
    filePath: ":memory:",
    now: () => 1_700_000_000_000,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  registry = createBoardRegistry({ store })
  changes = []
  registry.subscribe((change) => changes.push(change))
}

beforeEach(setup)

function seed() {
  const board = registry.createBoard({
    owner: { kind: "project", id: "project-1" },
    title: "Sprint",
    definition: DEFINITION,
  })
  const columns = store.listColumns(board.id)
  const card = registry.createCard({
    boardId: board.id,
    columnId: columns[0]!.id,
    title: "Task",
    actor: USER,
  })
  changes.length = 0
  return { board, columns, card }
}

describe("change broadcasting", () => {
  test("every mutating method emits exactly one change carrying board and owner", () => {
    // Structural gate: a write that does not broadcast leaves the UI stale and
    // is invisible in review. Each entry here is one mutating method.
    const { board, columns, card } = seed()
    const owner: BoardOwnerRef = { kind: "project", id: "project-1" }

    const mutations: { name: string; run: () => void }[] = [
      { name: "updateBoard", run: () => registry.updateBoard(board.id, { title: "Renamed" }) },
      { name: "createColumn", run: () => registry.createColumn({ boardId: board.id, title: "Extra" }) },
      { name: "updateColumn", run: () => registry.updateColumn(columns[0]!.id, { title: "To do" }) },
      {
        name: "moveColumn",
        run: () => registry.moveColumn({ columnId: columns[2]!.id, afterColumnId: null }),
      },
      {
        name: "createCard",
        run: () => registry.createCard({ boardId: board.id, columnId: columns[1]!.id, title: "B", actor: USER }),
      },
      { name: "updateCard", run: () => registry.updateCard(card.id, { title: "Task 2" }, USER) },
      {
        name: "moveCard",
        run: () =>
          registry.moveCard({
            cardId: card.id,
            toColumnId: columns[1]!.id,
            aboveCardId: null,
            belowCardId: null,
            actor: AGENT,
          }),
      },
      { name: "addCardLink", run: () => registry.addCardLink(card.id, "chat", "chat-9") },
      { name: "removeCardLink", run: () => registry.removeCardLink(card.id, "chat", "chat-9") },
      { name: "addComment", run: () => registry.addComment(card.id, USER, "note") },
      { name: "archiveCard", run: () => registry.archiveCard(card.id, USER) },
      { name: "deleteColumn", run: () => registry.deleteColumn(columns[2]!.id) },
      { name: "archiveBoard", run: () => registry.archiveBoard(board.id) },
    ]

    for (const mutation of mutations) {
      changes.length = 0
      mutation.run()
      expect({ name: mutation.name, count: changes.length }).toEqual({ name: mutation.name, count: 1 })
      expect({ name: mutation.name, change: changes[0] }).toEqual({
        name: mutation.name,
        change: { boardId: board.id, owner },
      })
    }
  })

  test("creating a board emits for the new board and its owner", () => {
    const board = registry.createBoard({ owner: { kind: "stack", id: "stack-1" }, title: "Stack board" })
    expect(changes).toEqual([{ boardId: board.id, owner: { kind: "stack", id: "stack-1" } }])
  })

  test("deleting a column still resolves its board, even though the row is gone after", () => {
    // The board id must be read BEFORE the write, or the broadcast has nowhere
    // to go.
    const { board, columns } = seed()
    registry.deleteColumn(columns[2]!.id)
    expect(changes).toEqual([{ boardId: board.id, owner: { kind: "project", id: "project-1" } }])
  })

  test("reads never emit", () => {
    const { board, card, columns } = seed()
    registry.listBoards({ kind: "project", id: "project-1" })
    registry.boardView(board.id)
    registry.cardPage({ columnId: columns[0]!.id, limit: 5 })
    registry.cardDetail(card.id)
    registry.listTemplates()
    registry.getTemplate("builtin-scrum")
    registry.findCardsByLink("chat", "chat-9")
    expect(changes).toEqual([])
  })

  test("a failed write emits nothing", () => {
    const { columns } = seed()
    expect(() => registry.deleteColumn(columns[0]!.id)).toThrow(BoardStoreError)
    expect(changes).toEqual([])
  })

  test("a throwing subscriber neither aborts the write nor silences the others", () => {
    const { board } = seed()
    const seen: string[] = []
    registry.subscribe(() => {
      throw new Error("subscriber exploded")
    })
    registry.subscribe((change) => seen.push(change.boardId))

    expect(() => registry.updateBoard(board.id, { title: "Still renamed" })).not.toThrow()
    expect(registry.boardView(board.id)?.board.title).toBe("Still renamed")
    expect(seen).toEqual([board.id])
  })

  test("unsubscribing stops delivery", () => {
    const { board } = seed()
    const seen: BoardChange[] = []
    const dispose = registry.subscribe((change) => seen.push(change))
    registry.updateBoard(board.id, { title: "One" })
    dispose()
    registry.updateBoard(board.id, { title: "Two" })
    expect(seen).toHaveLength(1)
  })
})

describe("read models", () => {
  test("listBoards summarises columns and cards", () => {
    const { board } = seed()
    registry.createCard({
      boardId: board.id,
      columnId: store.listColumns(board.id)[1]!.id,
      title: "Second",
      actor: USER,
    })
    expect(registry.listBoards({ kind: "project", id: "project-1" })).toEqual([
      {
        id: board.id,
        title: "Sprint",
        description: null,
        columnCount: 3,
        cardCount: 2,
        updatedAt: 1_700_000_000_000,
      },
    ])
  })

  test("boardView carries totals so skeletons can be sized before cards arrive", () => {
    const board = registry.createBoard({
      owner: { kind: "project", id: "p" },
      title: "Big",
      definition: DEFINITION,
    })
    const column = store.listColumns(board.id)[0]!
    let previous: string | null = null
    for (let index = 0; index < DEFAULT_BOARD_PAGE_SIZE + 12; index += 1) {
      previous = registry.createCard({
        boardId: board.id,
        columnId: column.id,
        title: `Card ${index}`,
        actor: USER,
        afterCardId: previous,
      }).id
    }

    const view = registry.boardView(board.id)
    expect(view?.counts[column.id]).toBe(DEFAULT_BOARD_PAGE_SIZE + 12)
    expect(view?.cards[column.id]).toHaveLength(DEFAULT_BOARD_PAGE_SIZE)
    expect(view?.cursors[column.id]).not.toBeNull()

    const rest = registry.cardPage({
      columnId: column.id,
      limit: 100,
      afterRank: view?.cursors[column.id] ?? null,
    })
    expect(rest.cards).toHaveLength(12)
    expect(rest.nextCursor).toBeNull()
  })

  test("boardView gives every column an entry, including empty ones", () => {
    const { board, columns } = seed()
    const view = registry.boardView(board.id)
    expect(Object.keys(view?.cards ?? {}).sort()).toEqual(columns.map((column) => column.id).sort())
    expect(view?.cards[columns[2]!.id]).toEqual([])
    expect(view?.counts[columns[2]!.id]).toBe(0)
  })

  test("boardView is null for an unknown board", () => {
    expect(registry.boardView("nope")).toBeNull()
  })

  test("cardDetail bundles links and comments", () => {
    const { card } = seed()
    registry.addCardLink(card.id, "worktree", "/repo/.worktrees/card-1")
    registry.addComment(card.id, AGENT, "Started")

    const detail = registry.cardDetail(card.id)
    expect(detail?.card.id).toBe(card.id)
    expect(detail?.links.map((link) => link.kind)).toEqual(["worktree"])
    expect(detail?.comments.map((comment) => comment.body)).toEqual(["Started"])
    expect(registry.cardDetail("missing")).toBeNull()
  })
})
