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

    // A raised page size is how the client pages: one bigger read, complete
    // prefix, nothing to merge on the way back.
    const grown = registry.boardView(board.id, DEFAULT_BOARD_PAGE_SIZE * 2)
    expect(grown?.cards[column.id]).toHaveLength(DEFAULT_BOARD_PAGE_SIZE + 12)
    expect(grown?.cursors[column.id]).toBeNull()
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

  test("boardView carries chat links only for the cards that have them", () => {
    const { board, columns, card } = seed()
    const unlinked = registry.createCard({
      boardId: board.id,
      columnId: columns[1]!.id,
      title: "Worktree only",
      actor: USER,
    })
    registry.addCardLink(card.id, "chat", "chat-9")
    registry.addCardLink(unlinked.id, "worktree", "/repo/.worktrees/card-2")

    expect(registry.boardView(board.id)?.chatLinksByCard).toEqual({ [card.id]: ["chat-9"] })
  })

  test("boardView leaves out the chat links of cards past the page it ships", () => {
    const { board, columns, card } = seed()
    let previous = card.id
    const rest = ["Second", "Third"].map((title) => {
      const created = registry.createCard({
        boardId: board.id,
        columnId: columns[0]!.id,
        title,
        actor: USER,
        afterCardId: previous,
      })
      previous = created.id
      return created
    })
    registry.addCardLink(card.id, "chat", "chat-1")
    registry.addCardLink(rest[1]!.id, "chat", "chat-3")

    const view = registry.boardView(board.id, 2)
    expect(view?.cards[columns[0]!.id]?.map((entry) => entry.id)).toEqual([card.id, rest[0]!.id])
    expect(view?.chatLinksByCard).toEqual({ [card.id]: ["chat-1"] })
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

  test("cardDetail carries the tracker reference the branch name is derived from", () => {
    const { board, card } = seed()
    expect(registry.cardDetail(card.id)?.externalRef).toBeNull()

    const binding = registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      projectId: null,
      sourceRef: { provider: "github-issues", owner: "o", repo: "r" },
      direction: "pull",
      allowAgentPush: false,
    })
    store.upsertSyncLink({
      cardId: card.id,
      bindingId: binding.id,
      externalId: "412",
      externalUrl: "https://github.test/o/r/issues/412",
      fieldWatermarks: {},
      lastSyncedAt: 0,
    })

    expect(registry.cardDetail(card.id)?.externalRef).toBe("412")
  })

  test("getBoard and listColumns expose what Start work resolves against", () => {
    const { board } = seed()
    expect(registry.getBoard(board.id)?.title).toBe("Sprint")
    expect(registry.getBoard("missing")).toBeNull()
    expect(registry.listColumns(board.id).map((column) => column.semantic)).toEqual([
      "start",
      "active",
      "done",
    ])
  })
})

/**
 * One repo binds to exactly ONE board.
 *
 * `sync_link_external_idx` is unique per `(binding_id, external_id)` — per
 * BINDING, not per issue — so two bindings on the same repo each hold every
 * issue as a SEPARATE card, with two sync links and two outbox entries, and the
 * two boards then race each other last-writer-wins onto the real tracker. The
 * rule is cross-board, so no index can express it; the registry is where it
 * lives.
 */
describe("one repo, one board", () => {
  const REPO = { provider: "github-issues", owner: "acme", repo: "widgets" } as const

  function boards() {
    const project = registry.createBoard({
      owner: { kind: "project", id: "project-1" },
      title: "Widgets",
      definition: DEFINITION,
    })
    const stack = registry.createBoard({
      owner: { kind: "stack", id: "stack-1" },
      title: "Q3",
      definition: DEFINITION,
    })
    return { project, stack }
  }

  function bind(boardId: string, extra: { detachFromBoardId?: string | null } = {}) {
    return registry.bindSync({
      boardId,
      providerId: "github-issues",
      projectId: "project-1",
      sourceRef: REPO,
      direction: "pull",
      allowAgentPush: false,
      ...extra,
    })
  }

  test("connecting a repo another board holds is refused without the explicit move", () => {
    const { project, stack } = boards()
    bind(project.id)

    expect(() => bind(stack.id)).toThrow(BoardStoreError)
    // Refused means nothing moved: the original binding is untouched.
    expect(registry.listBindings(project.id)).toHaveLength(1)
    expect(registry.listBindings(stack.id)).toHaveLength(0)
  })

  test("the refusal names the repo, because a board id is not something a reader can act on", () => {
    const { project, stack } = boards()
    bind(project.id)
    expect(() => bind(stack.id)).toThrow(/acme\/widgets/)
  })

  test("naming the WRONG board is refused too — a stale screen must not detach a board nobody saw", () => {
    const { project, stack } = boards()
    bind(project.id)
    expect(() => bind(stack.id, { detachFromBoardId: "some-other-board" })).toThrow(BoardStoreError)
    expect(registry.listBindings(project.id)).toHaveLength(1)
  })

  test("a confirmed move takes the old binding and its sync links, and orphans no card", () => {
    const { project, stack } = boards()
    const original = bind(project.id)
    const column = store.listColumns(project.id)[0]
    if (!column) throw new Error("seeded board has no columns")
    const card = registry.createCard({
      boardId: project.id,
      columnId: column.id,
      title: "Issue 412",
      actor: USER,
    })
    store.upsertSyncLink({
      cardId: card.id,
      bindingId: original.id,
      externalId: "412",
      externalUrl: "https://github.test/acme/widgets/issues/412",
      fieldWatermarks: {},
      lastSyncedAt: 0,
    })

    const moved = bind(stack.id, { detachFromBoardId: project.id })

    expect(moved.boardId).toBe(stack.id)
    expect(registry.listBindings(project.id)).toHaveLength(0)
    expect(registry.listBindings(stack.id).map((b) => b.sourceRef)).toEqual([REPO])
    // The link went with the binding it belonged to...
    expect(store.getSyncLinkByExternal(original.id, "412")).toBeNull()
    // ...but unbinding is not deleting the work: the card stays where it is.
    expect(store.getCard(card.id)?.title).toBe("Issue 412")
  })

  test("re-connecting the SAME board needs no confirmation — that is an edit, not a move", () => {
    const { project } = boards()
    const first = bind(project.id)
    const again = registry.bindSync({
      boardId: project.id,
      providerId: "github-issues",
      projectId: "project-1",
      sourceRef: REPO,
      direction: "both",
      allowAgentPush: true,
    })
    expect(again.id).toBe(first.id)
    expect(again.direction).toBe("both")
  })

  test("repoBindingOwner names the holder and its card count, and ignores the board asking", () => {
    const { project, stack } = boards()
    bind(project.id)
    const column = store.listColumns(project.id)[0]
    if (!column) throw new Error("seeded board has no columns")
    registry.createCard({ boardId: project.id, columnId: column.id, title: "one", actor: USER })
    registry.createCard({ boardId: project.id, columnId: column.id, title: "two", actor: USER })

    expect(registry.repoBindingOwner("github-issues", REPO, stack.id)).toEqual({
      boardId: project.id,
      boardTitle: "Widgets",
      cardCount: 2,
    })
    // The board already holding it is not a conflict with itself.
    expect(registry.repoBindingOwner("github-issues", REPO, project.id)).toBeNull()
  })

  test("an unheld repo has no owner, so the screen offers a plain Connect", () => {
    const { stack } = boards()
    expect(registry.repoBindingOwner("github-issues", REPO, stack.id)).toBeNull()
  })

  test("a move broadcasts, so both boards' viewers see the change", () => {
    const { project, stack } = boards()
    bind(project.id)
    changes = []
    bind(stack.id, { detachFromBoardId: project.id })
    expect(changes.map((c) => c.boardId)).toContain(stack.id)
  })
})
