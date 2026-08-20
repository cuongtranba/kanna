import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createBoardStore } from "./board-store.adapter"
import { BoardStoreError, cardBranchName, validateCardContent, type BoardStore } from "./board-store"
import { BUILTIN_BOARD_TEMPLATES } from "./board-templates"
import type { BoardTemplateDefinition, CardActor, FieldDef, RemoteSourceRef } from "../shared/boards/types"

const USER: CardActor = { kind: "user" }
const AGENT: CardActor = { kind: "agent", chatId: "chat-1" }

const SIMPLE_DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: "muted-icon", wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: "warning", wipLimit: 2 },
    { title: "Done", semantic: "done", colorToken: "success", wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

const openStores: BoardStore[] = []
const tempDirs: string[] = []

function newStore(filePath = ":memory:", now: () => number = () => 1_700_000_000_000): BoardStore {
  let counter = 0
  const store = createBoardStore({
    filePath,
    now,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  openStores.push(store)
  return store
}

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-board-test-"))
  tempDirs.push(dir)
  return dir
}

function seedBoard(store: BoardStore) {
  const board = store.createBoard({
    owner: { kind: "project", id: "project-1" },
    title: "Sprint board",
    definition: SIMPLE_DEFINITION,
  })
  const columns = store.listColumns(board.id)
  return { board, columns }
}

afterEach(() => {
  while (openStores.length > 0) {
    try {
      openStores.pop()?.close()
    } catch {
      // A test may have closed the store itself.
    }
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe("migrations and seeding", () => {
  test("a fresh database gets every built-in template exactly once", () => {
    const store = newStore()
    const templates = store.listTemplates()
    expect(templates).toHaveLength(BUILTIN_BOARD_TEMPLATES.length)
    expect(templates.every((template) => template.builtin)).toBe(true)
    expect(templates.map((template) => template.id).sort()).toEqual(
      BUILTIN_BOARD_TEMPLATES.map((template) => template.id).sort(),
    )
  })

  test("reopening the same file does not re-run migrations or duplicate templates", () => {
    const filePath = path.join(newTempDir(), "boards.db")
    const first = newStore(filePath)
    const board = first.createBoard({ owner: { kind: "project", id: "p" }, title: "Kept" })
    first.close()

    const second = newStore(filePath)
    expect(second.listTemplates()).toHaveLength(BUILTIN_BOARD_TEMPLATES.length)
    expect(second.getBoard(board.id)?.title).toBe("Kept")
  })

  test("creates parent directories for the database file", () => {
    const filePath = path.join(newTempDir(), "nested", "deeper", "boards.db")
    const store = newStore(filePath)
    expect(store.listTemplates().length).toBeGreaterThan(0)
  })

  test("the dev pipeline template carries the stages the board is built around", () => {
    const store = newStore()
    const pipeline = store.getTemplate("builtin-dev-pipeline")
    expect(pipeline?.definition.columns.map((column) => column.title)).toEqual([
      "Backlog",
      "Todo",
      "In progress",
      "Test",
      "QA",
      "Deployment",
    ])
    // "Start work" and the worktree-cleanup prompt both key off these.
    expect(pipeline?.definition.columns.find((column) => column.semantic === "active")?.title).toBe("In progress")
    expect(pipeline?.definition.columns.find((column) => column.semantic === "done")?.title).toBe("Deployment")
  })
})

describe("boards", () => {
  test("creating a board from a definition instantiates its columns in order", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    expect(board.ownerKind).toBe("project")
    expect(columns.map((column) => column.title)).toEqual(["Todo", "Doing", "Done"])
    expect(columns.map((column) => column.rank)).toEqual([...columns.map((c) => c.rank)].sort())
  })

  test("a board with no definition starts empty", () => {
    const store = newStore()
    const board = store.createBoard({ owner: { kind: "project", id: "p" }, title: "Blank" })
    expect(store.listColumns(board.id)).toEqual([])
    expect(board.cardFields).toEqual([])
  })

  test("boards are listed per owner, and a stack owns its own boards", () => {
    const store = newStore()
    store.createBoard({ owner: { kind: "project", id: "p1" }, title: "One" })
    store.createBoard({ owner: { kind: "project", id: "p2" }, title: "Two" })
    store.createBoard({ owner: { kind: "stack", id: "p1" }, title: "Stack board" })

    expect(store.listBoards({ kind: "project", id: "p1" }).map((b) => b.title)).toEqual(["One"])
    // Same id, different owner kind: must not bleed across.
    expect(store.listBoards({ kind: "stack", id: "p1" }).map((b) => b.title)).toEqual(["Stack board"])
  })

  test("archiving hides a board from its owner's list but keeps it readable", () => {
    const store = newStore()
    const { board } = seedBoard(store)
    store.archiveBoard(board.id)
    expect(store.listBoards({ kind: "project", id: "project-1" })).toEqual([])
    expect(store.getBoard(board.id)?.archivedAt).not.toBeNull()
  })

  test("updating leaves untouched fields alone", () => {
    const store = newStore()
    const { board } = seedBoard(store)
    const fields: FieldDef[] = [{ id: "notes", label: "Notes", kind: "text", options: null, required: false }]
    store.updateBoard(board.id, { description: "A description" })
    const updated = store.updateBoard(board.id, { cardFields: fields })
    expect(updated.description).toBe("A description")
    expect(updated.cardFields).toEqual(fields)
    expect(updated.title).toBe("Sprint board")
  })

  test("rejects a blank title", () => {
    const store = newStore()
    expect(() => store.createBoard({ owner: { kind: "project", id: "p" }, title: "  " })).toThrow(BoardStoreError)
  })

  test("reports a missing board rather than returning a hollow one", () => {
    const store = newStore()
    expect(store.getBoard("nope")).toBeNull()
    expect(() => store.updateBoard("nope", { title: "x" })).toThrow(BoardStoreError)
  })
})

describe("columns", () => {
  test("a new column can be placed at the front, middle, or end", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)

    store.createColumn({ boardId: board.id, title: "First", afterColumnId: null })
    store.createColumn({ boardId: board.id, title: "Middle", afterColumnId: columns[0]!.id })
    store.createColumn({ boardId: board.id, title: "Last", afterColumnId: columns[2]!.id })

    expect(store.listColumns(board.id).map((column) => column.title)).toEqual([
      "First",
      "Todo",
      "Middle",
      "Doing",
      "Done",
      "Last",
    ])
  })

  test("moving a column reorders without touching the others", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const ranksBefore = new Map(columns.map((column) => [column.id, column.rank]))

    store.moveColumn({ columnId: columns[2]!.id, afterColumnId: null })

    const after = store.listColumns(board.id)
    expect(after.map((column) => column.title)).toEqual(["Done", "Todo", "Doing"])
    // Only the moved column's rank changed: that is the point of fractional order.
    expect(after.find((c) => c.title === "Todo")!.rank).toBe(ranksBefore.get(columns[0]!.id)!)
    expect(after.find((c) => c.title === "Doing")!.rank).toBe(ranksBefore.get(columns[1]!.id)!)
  })

  test("moving a column to the end works even though it is already last", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    store.moveColumn({ columnId: columns[0]!.id, afterColumnId: columns[2]!.id })
    expect(store.listColumns(board.id).map((column) => column.title)).toEqual(["Doing", "Done", "Todo"])
  })

  test("a column cannot follow itself", () => {
    const store = newStore()
    const { columns } = seedBoard(store)
    expect(() => store.moveColumn({ columnId: columns[0]!.id, afterColumnId: columns[0]!.id })).toThrow(
      BoardStoreError,
    )
  })

  test("deleting refuses while cards remain, and succeeds once they are gone", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "Blocking card",
      actor: USER,
    })

    expect(() => store.deleteColumn(columns[0]!.id)).toThrow(BoardStoreError)
    store.archiveCard(card.id, USER)
    store.deleteColumn(columns[0]!.id)
    expect(store.listColumns(board.id).map((column) => column.title)).toEqual(["Doing", "Done"])
  })

  test("updating a column keeps its semantic when the patch omits it", () => {
    const store = newStore()
    const { columns } = seedBoard(store)
    const updated = store.updateColumn(columns[1]!.id, { title: "In progress" })
    expect(updated.title).toBe("In progress")
    expect(updated.semantic).toBe("active")
    expect(updated.wipLimit).toBe(2)
  })
})

describe("cards", () => {
  test("cards are created in order and counted per column", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const first = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "A", actor: USER })
    const second = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "B",
      actor: USER,
      afterCardId: first.id,
    })
    store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "C",
      actor: USER,
      afterCardId: second.id,
    })

    expect(store.listCardPage({ columnId: columns[0]!.id, limit: 10 }).cards.map((c) => c.title)).toEqual([
      "A",
      "B",
      "C",
    ])
    expect(store.countCardsByColumn(board.id)).toEqual({
      [columns[0]!.id]: 3,
      [columns[1]!.id]: 0,
      [columns[2]!.id]: 0,
    })
  })

  test("a card created with no neighbour lands at the top", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Existing", actor: USER })
    store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Newer", actor: USER })
    expect(store.listCardPage({ columnId: columns[0]!.id, limit: 10 }).cards.map((c) => c.title)).toEqual([
      "Newer",
      "Existing",
    ])
  })

  test("moving a card across columns records who moved it", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })

    const moved = store.moveCard({
      cardId: card.id,
      toColumnId: columns[1]!.id,
      aboveCardId: null,
      belowCardId: null,
      actor: AGENT,
    })

    expect(moved.columnId).toBe(columns[1]!.id)
    // Attribution drives the agent-push hold; it is not cosmetic.
    expect(moved.updatedBy).toEqual(AGENT)
    expect(store.countCardsByColumn(board.id)[columns[0]!.id]).toBe(0)
    expect(store.countCardsByColumn(board.id)[columns[1]!.id]).toBe(1)
  })

  test("a drop between two cards lands exactly between them", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const a = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "A", actor: USER })
    const b = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "B",
      actor: USER,
      afterCardId: a.id,
    })
    const c = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "C",
      actor: USER,
      afterCardId: b.id,
    })

    store.moveCard({ cardId: c.id, toColumnId: columns[0]!.id, aboveCardId: a.id, belowCardId: b.id, actor: USER })

    expect(store.listCardPage({ columnId: columns[0]!.id, limit: 10 }).cards.map((x) => x.title)).toEqual([
      "A",
      "C",
      "B",
    ])
  })

  test("a WIP limit never blocks a move", () => {
    // Advisory by design: a hard limit would wedge an agent mid-run.
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const doing = columns[1]!
    expect(doing.wipLimit).toBe(2)
    for (const title of ["1", "2", "3", "4"]) {
      const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title, actor: USER })
      store.moveCard({
        cardId: card.id,
        toColumnId: doing.id,
        aboveCardId: null,
        belowCardId: null,
        actor: AGENT,
      })
    }
    expect(store.countCardsByColumn(board.id)[doing.id]).toBe(4)
  })

  test("rejects a move onto another board's column", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const other = store.createBoard({
      owner: { kind: "project", id: "project-2" },
      title: "Other",
      definition: SIMPLE_DEFINITION,
    })
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    const foreign = store.listColumns(other.id)[0]!

    expect(() =>
      store.moveCard({
        cardId: card.id,
        toColumnId: foreign.id,
        aboveCardId: null,
        belowCardId: null,
        actor: USER,
      }),
    ).toThrow(BoardStoreError)
  })

  test("rejects a neighbour that lives in a different column", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    const elsewhere = store.createCard({
      boardId: board.id,
      columnId: columns[2]!.id,
      title: "Elsewhere",
      actor: USER,
    })

    expect(() =>
      store.moveCard({
        cardId: card.id,
        toColumnId: columns[1]!.id,
        aboveCardId: elsewhere.id,
        belowCardId: null,
        actor: USER,
      }),
    ).toThrow(BoardStoreError)
  })

  test("rejects a card being its own neighbour", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    expect(() =>
      store.moveCard({
        cardId: card.id,
        toColumnId: columns[0]!.id,
        aboveCardId: card.id,
        belowCardId: null,
        actor: USER,
      }),
    ).toThrow(BoardStoreError)
  })

  test("archived cards vanish from pages and counts but survive on disk", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    store.archiveCard(card.id, USER)

    expect(store.listCardPage({ columnId: columns[0]!.id, limit: 10 }).cards).toEqual([])
    expect(store.countCardsByColumn(board.id)[columns[0]!.id]).toBe(0)
    expect(store.getCard(card.id)?.archivedAt).not.toBeNull()
  })

  test("content round-trips through JSON with its value kinds intact", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "Typed",
      actor: USER,
      content: {
        description: { kind: "longtext", value: "Body" },
        priority: { kind: "select", optionId: "high" },
        labels: { kind: "label", values: ["auth", "bug"] },
        due: { kind: "date", value: 1_700_000_000_000 },
      },
    })
    expect(store.getCard(card.id)?.content).toEqual({
      description: { kind: "longtext", value: "Body" },
      priority: { kind: "select", optionId: "high" },
      labels: { kind: "label", values: ["auth", "bug"] },
      due: { kind: "date", value: 1_700_000_000_000 },
    })
  })

  test("a card on a stack board keeps the project its work belongs to", () => {
    const store = newStore()
    const board = store.createBoard({
      owner: { kind: "stack", id: "stack-1" },
      title: "Cross-project",
      definition: SIMPLE_DEFINITION,
    })
    const columns = store.listColumns(board.id)
    const card = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "Fix in project 2",
      projectId: "project-2",
      actor: USER,
    })
    // Without this, "Start work" on a stack board has no checkout to use.
    expect(store.getCard(card.id)?.projectId).toBe("project-2")
  })
})

describe("ordering parity with SQLite", () => {
  test("SQLite's ORDER BY matches JavaScript's string ordering for order keys", () => {
    // The whole ordering design rests on this. If it ever diverges, cards
    // silently render in a different order than they are stored in.
    const store = newStore()
    const { board, columns } = seedBoard(store)

    let previous: string | null = null
    for (let index = 0; index < 120; index += 1) {
      const card = store.createCard({
        boardId: board.id,
        columnId: columns[0]!.id,
        title: `Card ${index}`,
        actor: USER,
        afterCardId: previous,
      })
      previous = card.id
    }

    const fromSqlite = store.listCardPage({ columnId: columns[0]!.id, limit: 500 }).cards
    const ranks = fromSqlite.map((card) => card.rank)
    expect(ranks).toEqual([...ranks].sort())
    expect(fromSqlite.map((card) => card.title)).toEqual(
      Array.from({ length: 120 }, (_unused, index) => `Card ${index}`),
    )
  })

  test("paging walks the whole column exactly once", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    let previous: string | null = null
    for (let index = 0; index < 47; index += 1) {
      const card = store.createCard({
        boardId: board.id,
        columnId: columns[0]!.id,
        title: `Card ${index}`,
        actor: USER,
        afterCardId: previous,
      })
      previous = card.id
    }

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: ReturnType<BoardStore["listCardPage"]> = store.listCardPage({
        columnId: columns[0]!.id,
        limit: 10,
        afterRank: cursor,
      })
      expect(page.total).toBe(47)
      seen.push(...page.cards.map((card) => card.title))
      cursor = page.nextCursor
      pages += 1
    } while (cursor !== null && pages < 20)

    expect(seen).toHaveLength(47)
    expect(new Set(seen).size).toBe(47)
  })

  test("rebalancing preserves order while shortening the keys", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const first = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "First", actor: USER })
    let below = store.createCard({
      boardId: board.id,
      columnId: columns[0]!.id,
      title: "Last",
      actor: USER,
      afterCardId: first.id,
    })
    // Hammer the same gap so keys grow.
    for (let index = 0; index < 60; index += 1) {
      below = store.moveCard({
        cardId: below.id,
        toColumnId: columns[0]!.id,
        aboveCardId: first.id,
        belowCardId: null,
        actor: USER,
      })
    }

    const before = store.listCardPage({ columnId: columns[0]!.id, limit: 100 }).cards
    store.rebalanceColumn(columns[0]!.id)
    const after = store.listCardPage({ columnId: columns[0]!.id, limit: 100 }).cards

    expect(after.map((card) => card.id)).toEqual(before.map((card) => card.id))
    expect(Math.max(...after.map((card) => card.rank.length))).toBeLessThanOrEqual(10)
  })
})

describe("links and comments", () => {
  test("a card link is idempotent and reversible", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })

    store.addCardLink(card.id, "chat", "chat-9")
    store.addCardLink(card.id, "chat", "chat-9")
    expect(store.listCardLinks(card.id)).toHaveLength(1)

    store.removeCardLink(card.id, "chat", "chat-9")
    expect(store.listCardLinks(card.id)).toEqual([])
  })

  test("a card can be found from the chat or worktree it owns", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    store.addCardLink(card.id, "chat", "chat-9")
    store.addCardLink(card.id, "worktree", "/repo/.worktrees/card-412")

    expect(store.findCardsByLink("chat", "chat-9").map((c) => c.id)).toEqual([card.id])
    expect(store.findCardsByLink("worktree", "/repo/.worktrees/card-412").map((c) => c.id)).toEqual([card.id])
    expect(store.findCardsByLink("chat", "chat-absent")).toEqual([])
  })

  test("a board's links of one kind read back in a single grouped, newest-first pass", () => {
    let clock = 1_700_000_000_000
    const store = newStore(":memory:", () => (clock += 1))
    const { board, columns } = seedBoard(store)
    const first = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "First", actor: USER })
    const second = store.createCard({ boardId: board.id, columnId: columns[1]!.id, title: "Second", actor: USER })
    const elsewhere = seedBoard(store)
    const stray = store.createCard({
      boardId: elsewhere.board.id,
      columnId: elsewhere.columns[0]!.id,
      title: "Stray",
      actor: USER,
    })

    store.addCardLink(first.id, "chat", "chat-older")
    store.addCardLink(first.id, "chat", "chat-newer")
    store.addCardLink(first.id, "worktree", "/repo/.worktrees/card-1")
    store.addCardLink(second.id, "chat", "chat-2")
    store.addCardLink(stray.id, "chat", "chat-elsewhere")

    const links = store.listCardLinksForBoard(board.id, "chat")
    expect(links.map((link) => `${link.cardId}:${link.targetId}`)).toEqual([
      `${first.id}:chat-newer`,
      `${first.id}:chat-older`,
      `${second.id}:chat-2`,
    ])
    expect(links[0]?.kind).toBe("chat")
  })

  test("a board with no links of the asked kind reads back empty", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    store.addCardLink(card.id, "worktree", "/repo/.worktrees/card-1")

    expect(store.listCardLinksForBoard(board.id, "chat")).toEqual([])
    expect(store.listCardLinksForBoard("missing", "chat")).toEqual([])
  })

  test("deleting a card takes its links and comments with it", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    store.addCardLink(card.id, "chat", "chat-9")
    store.addComment(card.id, USER, "A note")

    store.archiveCard(card.id, USER)
    store.deleteColumn(columns[0]!.id)

    expect(store.getCard(card.id)).toBeNull()
    expect(store.findCardsByLink("chat", "chat-9")).toEqual([])
    expect(store.listComments(card.id)).toEqual([])
  })

  test("comments keep their author and order", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    store.addComment(card.id, USER, "First")
    store.addComment(card.id, AGENT, "Second")

    const comments = store.listComments(card.id)
    expect(comments.map((comment) => comment.body)).toEqual(["First", "Second"])
    expect(comments[1]?.author).toEqual(AGENT)
  })

  test("rejects an empty comment and a link on a missing card", () => {
    const store = newStore()
    const { board, columns } = seedBoard(store)
    const card = store.createCard({ boardId: board.id, columnId: columns[0]!.id, title: "Task", actor: USER })
    expect(() => store.addComment(card.id, USER, "   ")).toThrow(BoardStoreError)
    expect(() => store.addCardLink("missing", "chat", "chat-1")).toThrow(BoardStoreError)
  })
})

describe("templates", () => {
  test("a user template can be created and deleted", () => {
    const store = newStore()
    const created = store.createTemplate({ name: "Mine", definition: SIMPLE_DEFINITION })
    expect(created.builtin).toBe(false)
    store.deleteTemplate(created.id)
    expect(store.getTemplate(created.id)).toBeNull()
  })

  test("built-in templates cannot be deleted", () => {
    const store = newStore()
    expect(() => store.deleteTemplate("builtin-scrum")).toThrow(BoardStoreError)
    expect(store.getTemplate("builtin-scrum")).not.toBeNull()
  })

  test("a board instantiated from a template carries its card schema", () => {
    const store = newStore()
    const template = store.getTemplate("builtin-github-issues")!
    const board = store.createBoard({
      owner: { kind: "project", id: "p" },
      title: "Issues",
      definition: template.definition,
      templateId: template.id,
    })
    expect(board.templateId).toBe(template.id)
    expect(board.cardFields.map((field) => field.id)).toContain("labels")
    expect(store.listColumns(board.id).map((column) => column.title)).toEqual(["Open", "In progress", "Closed"])
  })
})

describe("validateCardContent", () => {
  const fields: FieldDef[] = [
    { id: "notes", label: "Notes", kind: "text", options: null, required: false },
    {
      id: "priority",
      label: "Priority",
      kind: "select",
      required: true,
      options: [{ id: "high", label: "High", colorToken: "warning" }],
    },
  ]

  test("accepts content matching the schema", () => {
    expect(
      validateCardContent(
        { notes: { kind: "text", value: "ok" }, priority: { kind: "select", optionId: "high" } },
        fields,
      ),
    ).toEqual([])
  })

  /**
   * The two things it deliberately stays quiet about, both of which the WIRE
   * decoder refuses. See the function's own comment for why the store cannot
   * afford to agree with it.
   */
  test("says nothing about a field the schema has not declared", () => {
    expect(
      validateCardContent(
        { mystery: { kind: "text", value: "x" }, priority: { kind: "select", optionId: "high" } },
        fields,
      ),
    ).toEqual([])
  })

  test("says nothing about a required field the content omits", () => {
    expect(validateCardContent({}, fields)).toEqual([])
  })

  test("reports a mismatched kind and a bad option", () => {
    expect(validateCardContent({ notes: { kind: "number", value: 1 } }, fields)).toEqual([
      expect.stringContaining("expects text"),
    ])

    expect(
      validateCardContent({ priority: { kind: "select", optionId: "nonexistent" } }, fields),
    ).toEqual([expect.stringContaining("has no option")])
  })

  test("rejects a non-finite number and a fractional date", () => {
    const numberField: FieldDef[] = [
      { id: "n", label: "N", kind: "number", options: null, required: false },
      { id: "d", label: "D", kind: "date", options: null, required: false },
    ]
    const problems = validateCardContent(
      { n: { kind: "number", value: Number.POSITIVE_INFINITY }, d: { kind: "date", value: 1.5 } },
      numberField,
    )
    expect(problems).toHaveLength(2)
  })
})

describe("cardBranchName", () => {
  test("derives a readable branch from an external reference", () => {
    expect(cardBranchName("abcd1234-ef", "Fix: login redirect loop", "412")).toBe(
      "card/412-fix-login-redirect-loop",
    )
  })

  test("falls back to a short card id when there is no external reference", () => {
    expect(cardBranchName("abcd1234-efgh", "Add telemetry", null)).toBe("card/abcd1234-add-telemetry")
  })

  test("never emits a trailing or doubled separator", () => {
    const branch = cardBranchName("abcd1234", "  Weird   ***  title!!  ", "7")
    expect(branch).toBe("card/7-weird-title")
    expect(branch.endsWith("-")).toBe(false)
    expect(branch).not.toContain("--")
  })

  test("truncates a very long title without leaving a dangling separator", () => {
    const branch = cardBranchName("abcd1234", "a".repeat(200), "9")
    expect(branch.length).toBeLessThanOrEqual("card/9-".length + 48)
    expect(branch.endsWith("-")).toBe(false)
  })

  test("survives a title with no usable characters", () => {
    expect(cardBranchName("abcd1234", "***", "5")).toBe("card/5")
  })
})

/**
 * The store's own schema gate. The WS router validates the one path a person
 * edits from; this is what stands under every other caller — the sync engine,
 * the board MCP tools, and anything added next.
 */
describe("card content is checked against the board's fields", () => {
  const SCHEMA: BoardTemplateDefinition = {
    ...SIMPLE_DEFINITION,
    cardFields: [
      { id: "notes", label: "Notes", kind: "text", options: null, required: false },
      {
        id: "priority",
        label: "Priority",
        kind: "select",
        required: true,
        options: [{ id: "high", label: "High", colorToken: "warning" }],
      },
    ],
  }

  function seedTypedBoard(store: BoardStore) {
    const board = store.createBoard({
      owner: { kind: "project", id: "project-1" },
      title: "Typed board",
      definition: SCHEMA,
    })
    const column = store.listColumns(board.id)[0]
    if (!column) throw new Error("no column")
    const card = store.createCard({ boardId: board.id, columnId: column.id, title: "Card", actor: USER })
    return { board, column, card }
  }

  test("updateCard refuses a value whose kind disagrees with its field", () => {
    const store = newStore()
    const { card } = seedTypedBoard(store)
    expect(() =>
      store.updateCard(card.id, { content: { notes: { kind: "number", value: 3 } } }, USER),
    ).toThrow(/expects text/)
    expect(store.getCard(card.id)?.content).toEqual({})
  })

  test("updateCard refuses an option the board does not offer", () => {
    const store = newStore()
    const { card } = seedTypedBoard(store)
    expect(() =>
      store.updateCard(card.id, { content: { priority: { kind: "select", optionId: "urgent" } } }, USER),
    ).toThrow(/has no option/)
  })

  test("createCard refuses the same contradiction, so a bad card cannot be born", () => {
    const store = newStore()
    const { board, column } = seedTypedBoard(store)
    expect(() =>
      store.createCard({
        boardId: board.id,
        columnId: column.id,
        title: "Card",
        content: { notes: { kind: "date", value: 0 } },
        actor: USER,
      }),
    ).toThrow(BoardStoreError)
  })

  test("content matching the schema still writes", () => {
    const store = newStore()
    const { card } = seedTypedBoard(store)
    const updated = store.updateCard(
      card.id,
      { content: { notes: { kind: "text", value: "ok" }, priority: { kind: "select", optionId: "high" } } },
      USER,
    )
    expect(updated.content.notes).toEqual({ kind: "text", value: "ok" })
  })

  /**
   * The gate reports contradictions, not surprises. A board's schema is edited
   * under content already written, and the sync engine writes `description`
   * onto boards that have never declared it — refusing there would turn a
   * GitHub pull into a hard failure on every board made without a template.
   */
  test("a field the schema has not declared is stored, not refused", () => {
    const store = newStore()
    const { card } = seedTypedBoard(store)
    const updated = store.updateCard(
      card.id,
      { content: { description: { kind: "longtext", value: "from GitHub" } } },
      USER,
    )
    expect(updated.content.description).toEqual({ kind: "longtext", value: "from GitHub" })
  })

  /** `required` marks a field; it never refuses a save. */
  test("content omitting a required field still writes", () => {
    const store = newStore()
    const { card } = seedTypedBoard(store)
    expect(store.updateCard(card.id, { content: { notes: { kind: "text", value: "ok" } } }, USER).content)
      .toEqual({ notes: { kind: "text", value: "ok" } })
  })

  test("a title-only board takes any content, because it has said nothing to contradict", () => {
    const store = newStore()
    const { columns, board } = seedBoard(store)
    const column = columns[0]
    if (!column) throw new Error("no column")
    const card = store.createCard({ boardId: board.id, columnId: column.id, title: "Card", actor: USER })
    expect(
      store.updateCard(card.id, { content: { anything: { kind: "text", value: "x" } } }, USER).content,
    ).toEqual({ anything: { kind: "text", value: "x" } })
  })
})

/**
 * The table always allowed many bindings per board — `sync_binding_board_idx`
 * is a plain, non-unique index — so nothing here needed a migration. What was
 * missing was an application-level identity: `upsertBinding` used to look a
 * board up by `board_id` alone, which silently made "connect this board to a
 * second repo" mean "retarget the first".
 */
describe("sync bindings", () => {
  const REPO_1 = { provider: "github-issues", owner: "o1", repo: "r1" } as const
  const REPO_2 = { provider: "github-issues", owner: "o2", repo: "r2" } as const

  function seedBound(store: BoardStore) {
    const { board } = seedBoard(store)
    const binding = store.upsertBinding({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: REPO_1,
      direction: "both",
      allowAgentPush: false,
    })
    return { board, binding }
  }

  test("re-binding the same repo updates it in place rather than adding a duplicate", () => {
    const store = newStore()
    const { board, binding } = seedBound(store)

    const again = store.upsertBinding({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: REPO_1,
      direction: "pull",
      allowAgentPush: true,
    })

    expect(again.id).toBe(binding.id)
    const all = store.listBindings(board.id)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ direction: "pull", allowAgentPush: true })
  })

  test("binding a second repo adds a binding instead of retargeting the first", () => {
    const store = newStore()
    const { board, binding } = seedBound(store)

    const second = store.upsertBinding({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: REPO_2,
      direction: "both",
      allowAgentPush: false,
    })

    expect(second.id).not.toBe(binding.id)
    expect(store.listBindings(board.id).map((b) => b.sourceRef)).toEqual([REPO_1, REPO_2])
  })

  test("re-binding does not reset the cursor — a repo already read is not re-read", () => {
    const store = newStore()
    const { board, binding } = seedBound(store)
    store.setBindingCursor(binding.id, "cursor-1", 1_700_000_000_000)

    store.upsertBinding({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: REPO_1,
      direction: "pull",
      allowAgentPush: false,
    })

    expect(store.listBindings(board.id)[0]?.cursor).toBe("cursor-1")
  })

  test("deleting a binding takes its sync links with it and leaves the others alone", () => {
    const store = newStore()
    const { board, binding } = seedBound(store)
    const second = store.upsertBinding({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: REPO_2,
      direction: "both",
      allowAgentPush: false,
    })
    const { columns } = { columns: store.listColumns(board.id) }
    const column = columns[0]
    if (!column) throw new Error("no column")
    const card = store.createCard({ boardId: board.id, columnId: column.id, title: "Issue", actor: USER })
    store.upsertSyncLink({
      cardId: card.id,
      bindingId: binding.id,
      externalId: "1",
      externalUrl: null,
      fieldWatermarks: {},
      lastSyncedAt: 1,
    })

    store.deleteBinding(binding.id)

    expect(store.listBindings(board.id).map((b) => b.id)).toEqual([second.id])
    expect(store.getSyncLinkByCard(card.id, binding.id)).toBeNull()
    // The card itself survives: unbinding a repo is not deleting the work.
    expect(store.getCard(card.id)).not.toBeNull()
  })

  test("deleting a binding that is not there says so rather than silently succeeding", () => {
    const store = newStore()
    expect(() => store.deleteBinding("nope")).toThrow(BoardStoreError)
  })
})

/**
 * A binding remembers its checkout, and repos are findable across boards.
 *
 * Both exist for the Stack board: its cards come from several repos and the
 * board itself names none, so `projectId` is the only thing that can tell Start
 * work which worktree to mint — and `findBindingsBySource` is what lets the
 * connect screen see that a repo already belongs somewhere before it offers to
 * take it.
 */
describe("binding project + cross-board lookup", () => {
  const REPO_1 = { provider: "github-issues", owner: "o1", repo: "r1" } as const
  const REPO_2 = { provider: "github-issues", owner: "o2", repo: "r2" } as const

  function bind(store: BoardStore, boardId: string, sourceRef: RemoteSourceRef, projectId: string | null) {
    return store.upsertBinding({
      boardId,
      providerId: "github-issues",
      projectId,
      sourceRef,
      direction: "pull",
      allowAgentPush: false,
    })
  }

  test("projectId round-trips, and a binding that names no project reads back null", () => {
    const store = newStore()
    const { board } = seedBoard(store)

    expect(bind(store, board.id, REPO_1, "project-7").projectId).toBe("project-7")
    expect(bind(store, board.id, REPO_2, null).projectId).toBeNull()
    expect(store.listBindings(board.id).map((b) => b.projectId)).toEqual(["project-7", null])
  })

  test("re-binding updates the project, so a repo moved between checkouts is not stuck", () => {
    const store = newStore()
    const { board } = seedBoard(store)
    const first = bind(store, board.id, REPO_1, "project-7")

    const again = bind(store, board.id, REPO_1, "project-9")

    expect(again.id).toBe(first.id)
    expect(again.projectId).toBe("project-9")
  })

  test("findBindingsBySource reaches across boards — that is the whole point of it", () => {
    const store = newStore()
    const a = seedBoard(store).board
    const b = seedBoard(store).board
    bind(store, a.id, REPO_1, "p1")
    bind(store, b.id, REPO_1, "p1")
    bind(store, b.id, REPO_2, "p2")

    const holders = store.findBindingsBySource("github-issues", REPO_1)
    expect(holders.map((binding) => binding.boardId).sort()).toEqual([a.id, b.id].sort())
  })

  test("findBindingsBySource returns every holder, so a database that already broke the rule reports it whole", () => {
    const store = newStore()
    const a = seedBoard(store).board
    const b = seedBoard(store).board
    bind(store, a.id, REPO_1, "p1")
    bind(store, b.id, REPO_1, "p1")
    expect(store.findBindingsBySource("github-issues", REPO_1)).toHaveLength(2)
  })

  test("an unbound repo has no holders", () => {
    const store = newStore()
    seedBoard(store)
    expect(store.findBindingsBySource("github-issues", REPO_1)).toEqual([])
  })

  test("a different repo is not a match, even on a board that syncs one", () => {
    const store = newStore()
    const { board } = seedBoard(store)
    bind(store, board.id, REPO_1, "p1")
    expect(store.findBindingsBySource("github-issues", REPO_2)).toEqual([])
  })
})
