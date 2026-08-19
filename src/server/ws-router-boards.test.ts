import { describe, expect, test } from "bun:test"
import { handleBoardCommand, isBoardCommand, type BoardCommandDeps } from "./ws-router-boards"
import { createBoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { ServerEnvelope } from "../shared/protocol"
import type { StartWorkResult } from "../shared/boards/start-work"
import type { FieldDef } from "../shared/boards/types"

const RESULT: StartWorkResult = {
  cardId: "card-1",
  chatId: "chat-1",
  branch: "card/1-task",
  worktreePath: "/wt/card-1",
  movedToColumnId: "col-2",
  reused: false,
}

function setup(overrides: Partial<BoardCommandDeps> = {}) {
  const sent: ServerEnvelope[] = []
  const store = createBoardStore({ filePath: ":memory:" })
  const registry = createBoardRegistry({ store })
  const deps: BoardCommandDeps = {
    boardRegistry: registry,
    boardSync: undefined,
    startWork: () => Promise.resolve(RESULT),
    startWorkView: () =>
      Promise.resolve({ status: { kind: "idle" as const }, branch: "card/1-task", blockedReason: null }),
    cleanupView: () => Promise.resolve(null),
    suggestSyncRepos: () => Promise.resolve([]),
    resolveCleanup: () => Promise.resolve({ decision: "leave" as const, worktreePath: "/wt/card-1" }),
    send: (envelope) => sent.push(envelope),
    ...overrides,
  }
  return { deps, sent, registry }
}

describe("board.card.startWork", () => {
  test("is routed as a board command", () => {
    expect(isBoardCommand({ type: "board.card.startWork", cardId: "card-1" })).toBe(true)
  })

  test("acks with the result", async () => {
    const { deps, sent } = setup()
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent).toEqual([{ v: 1, type: "ack", id: "req-1", result: RESULT }])
  })

  /**
   * The dep is optional on the router, so an unwired server would otherwise
   * accept the command and answer nothing — the failure mode that hid the board
   * MCP tools for a whole phase.
   */
  test("says so when the server has no start-work wiring", async () => {
    const { deps, sent } = setup({ startWork: undefined })
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })

  test("a failure becomes an error envelope, not a thrown exception", async () => {
    const { deps, sent } = setup({ startWork: () => Promise.reject(new Error("branch already exists")) })
    await handleBoardCommand(deps, { type: "board.card.startWork", cardId: "card-1" }, "req-1")
    expect(sent[0]).toMatchObject({ type: "error", message: "branch already exists" })
  })
})

/**
 * `board.card.update` is the only path by which a user-defined field is ever
 * written, so what it refuses is the whole guarantee: the store REPLACES a
 * card's content with whatever it is handed, and it does not check that against
 * the board's schema.
 */
describe("board.card.update content", () => {
  const FIELDS: FieldDef[] = [
    { id: "description", label: "Description", kind: "longtext", options: null, required: false },
    {
      id: "priority",
      label: "Priority",
      kind: "select",
      required: false,
      options: [{ id: "high", label: "High", colorToken: "destructive" }],
    },
  ]

  function boardWithCard(deps: BoardCommandDeps) {
    const registry = deps.boardRegistry
    if (!registry) throw new Error("no registry")
    const board = registry.createBoard({
      owner: { kind: "project", id: "proj-1" },
      title: "Board",
      definition: { columns: [{ title: "Todo", semantic: null, colorToken: null, wipLimit: null }], cardFields: FIELDS, mappingDefaults: [] },
    })
    const column = registry.listColumns(board.id)[0]
    if (!column) throw new Error("no column")
    return registry.createCard({ boardId: board.id, columnId: column.id, title: "A card", actor: { kind: "user" } })
  }

  test("writes content the board's schema declares", async () => {
    const { deps, sent } = setup()
    const card = boardWithCard(deps)
    await handleBoardCommand(
      deps,
      {
        type: "board.card.update",
        cardId: card.id,
        content: { description: { kind: "longtext", value: "the body" } },
      },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "ack", id: "req-1" })
    expect(deps.boardRegistry?.cardDetail(card.id)?.card.content).toEqual({
      description: { kind: "longtext", value: "the body" },
    })
  })

  test("refuses a field the board does not declare, and says so rather than going quiet", async () => {
    const { deps, sent } = setup()
    const card = boardWithCard(deps)
    await handleBoardCommand(
      deps,
      { type: "board.card.update", cardId: card.id, content: { invented: { kind: "text", value: "x" } } },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
    expect(deps.boardRegistry?.cardDetail(card.id)?.card.content).toEqual({})
  })

  test("refuses a value whose kind disagrees with the schema", async () => {
    const { deps, sent } = setup()
    const card = boardWithCard(deps)
    await handleBoardCommand(
      deps,
      { type: "board.card.update", cardId: card.id, content: { description: { kind: "text", value: "x" } } },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })

  test("refuses an option the field does not offer", async () => {
    const { deps, sent } = setup()
    const card = boardWithCard(deps)
    await handleBoardCommand(
      deps,
      { type: "board.card.update", cardId: card.id, content: { priority: { kind: "select", optionId: "urgent" } } },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })

  /** A title-only update predates this and must keep working untouched. */
  test("a title-only update never consults the schema", async () => {
    const { deps, sent } = setup()
    const card = boardWithCard(deps)
    await handleBoardCommand(deps, { type: "board.card.update", cardId: card.id, title: "Renamed" }, "req-1")
    expect(sent[0]).toMatchObject({ type: "ack", id: "req-1" })
    expect(deps.boardRegistry?.cardDetail(card.id)?.card.title).toBe("Renamed")
  })

  test("a card that does not exist is an error, not a crash", async () => {
    const { deps, sent } = setup()
    await handleBoardCommand(
      deps,
      { type: "board.card.update", cardId: "nope", content: { description: { kind: "longtext", value: "x" } } },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })
})

/**
 * `board.update` is the only path by which a board's card schema is ever
 * written. The store writes `cardFields` whole and checks nothing, so what this
 * refuses is the whole guarantee — a duplicate field id would leave two fields
 * fighting over one card value with no way back.
 */
describe("board.update cardFields", () => {
  function newBoard(deps: BoardCommandDeps) {
    const registry = deps.boardRegistry
    if (!registry) throw new Error("no registry")
    return registry.createBoard({ owner: { kind: "project", id: "proj-1" }, title: "Board" })
  }

  const SCHEMA = [
    { id: "description", label: "Description", kind: "longtext", options: null, required: false },
    {
      id: "priority",
      label: "Priority",
      kind: "select",
      required: true,
      options: [{ id: "high", label: "High", colorToken: "warning" }],
    },
  ]

  test("gives a title-only board a schema", async () => {
    const { deps, sent } = setup()
    const board = newBoard(deps)
    expect(board.cardFields).toEqual([])

    await handleBoardCommand(deps, { type: "board.update", boardId: board.id, cardFields: SCHEMA }, "req-1")
    expect(sent[0]).toMatchObject({ type: "ack", id: "req-1" })
    expect(deps.boardRegistry?.getBoard(board.id)?.cardFields).toEqual(SCHEMA as never)
  })

  test("leaves the schema alone when the command does not carry one", async () => {
    const { deps } = setup()
    const board = newBoard(deps)
    await handleBoardCommand(deps, { type: "board.update", boardId: board.id, cardFields: SCHEMA }, "req-1")
    await handleBoardCommand(deps, { type: "board.update", boardId: board.id, title: "Renamed" }, "req-2")

    const updated = deps.boardRegistry?.getBoard(board.id)
    expect(updated?.title).toBe("Renamed")
    expect(updated?.cardFields).toHaveLength(2)
  })

  test("removing a field leaves the board with the fields that remain", async () => {
    const { deps } = setup()
    const board = newBoard(deps)
    await handleBoardCommand(deps, { type: "board.update", boardId: board.id, cardFields: SCHEMA }, "req-1")
    await handleBoardCommand(
      deps,
      { type: "board.update", boardId: board.id, cardFields: [SCHEMA[1]] },
      "req-2",
    )
    expect(deps.boardRegistry?.getBoard(board.id)?.cardFields.map((field) => field.id)).toEqual(["priority"])
  })

  test("answers with an error rather than persisting a schema it cannot read", async () => {
    const refusals: unknown[] = [
      [{ id: "a", label: "A", kind: "text", options: null, required: false }, { id: "a", label: "B", kind: "text", options: null, required: false }],
      [{ id: "a", label: "A", kind: "currency", options: null, required: false }],
      [{ id: "a", label: "A", kind: "select", required: false, options: [{ id: "x", label: "X", colorToken: "chartreuse" }] }],
      [
        {
          id: "a",
          label: "A",
          kind: "select",
          required: false,
          options: [{ id: "x", label: "X", colorToken: null }, { id: "x", label: "Y", colorToken: null }],
        },
      ],
      "not a schema",
    ]

    for (const cardFields of refusals) {
      const { deps, sent } = setup()
      const board = newBoard(deps)
      await handleBoardCommand(deps, { type: "board.update", boardId: board.id, cardFields }, "req-1")
      expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
      expect(deps.boardRegistry?.getBoard(board.id)?.cardFields).toEqual([])
    }
  })

  test("is routed as a board command", () => {
    expect(isBoardCommand({ type: "board.update", boardId: "board-1", cardFields: [] })).toBe(true)
  })
})

/**
 * `board.sync.status` is the ONLY way `BoardSyncStatus` reaches the client —
 * a plain request/ack, not a broadcast topic — so nothing else would catch a
 * shape change here.
 */
describe("board.sync", () => {
  function boundBoard(registry: ReturnType<typeof createBoardRegistry>) {
    return registry.createBoard({ owner: { kind: "project", id: "project-1" }, title: "Board" })
  }

  test("status carries EVERY binding, not just the first", async () => {
    const { deps, sent, registry } = setup()
    const board = boundBoard(registry)
    registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o1", repo: "r1" },
      direction: "both",
      allowAgentPush: false,
    })
    registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o2", repo: "r2" },
      direction: "pull",
      allowAgentPush: false,
    })

    await handleBoardCommand(deps, { type: "board.sync.status", boardId: board.id }, "req-1")

    const ack = sent[0] as { result: { bindings: { sourceRef: { owner: string } }[] } }
    expect(ack.result.bindings.map((b) => b.sourceRef.owner)).toEqual(["o1", "o2"])
  })

  test("status offers one repo suggestion per project, including projects with no remote", async () => {
    const { deps, sent, registry } = setup({
      suggestSyncRepos: () =>
        Promise.resolve([
          { projectId: "p1", projectName: "kanna", repo: { owner: "cuongtranba", repo: "kanna" } },
          // Listed, not dropped: the connect screen has to SAY "no remote"
          // about it, and silence would read as "already handled".
          { projectId: "p2", projectName: "scratch", repo: null },
        ]),
    })
    const board = boundBoard(registry)

    await handleBoardCommand(deps, { type: "board.sync.status", boardId: board.id }, "req-1")

    const ack = sent[0] as { result: { suggestedRepos: { projectId: string; repo: unknown }[] } }
    expect(ack.result.suggestedRepos).toHaveLength(2)
    expect(ack.result.suggestedRepos[1]).toMatchObject({ projectId: "p2", repo: null })
  })

  test("unbind disconnects one repo and leaves the board's other bindings alone", async () => {
    const { deps, sent, registry } = setup()
    const board = boundBoard(registry)
    const first = registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o1", repo: "r1" },
      direction: "both",
      allowAgentPush: false,
    })
    registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o2", repo: "r2" },
      direction: "both",
      allowAgentPush: false,
    })

    await handleBoardCommand(
      deps,
      { type: "board.sync.unbind", boardId: board.id, bindingId: first.id },
      "req-1",
    )

    expect(sent[0]).toMatchObject({ type: "ack", id: "req-1" })
    expect(registry.listBindings(board.id).map((b) => b.sourceRef.owner)).toEqual(["o2"])
  })

  test("unbinding something that is not bound is an error envelope, not a throw", async () => {
    const { deps, sent, registry } = setup()
    const board = boundBoard(registry)
    await handleBoardCommand(
      deps,
      { type: "board.sync.unbind", boardId: board.id, bindingId: "nope" },
      "req-1",
    )
    expect(sent[0]).toMatchObject({ type: "error", id: "req-1" })
  })
})
