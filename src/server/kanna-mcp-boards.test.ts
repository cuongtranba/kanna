import { beforeEach, describe, expect, test } from "bun:test"
import { buildBoardToolList } from "./kanna-mcp-boards"
import { createBoardRegistry, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { BoardStore } from "./board-store"
import type { BoardTemplateDefinition } from "../shared/boards/types"
import type { JsonObject } from "../shared/json"

const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: null, wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

interface CapturedTool {
  name: string
  run: (input: JsonObject) => Promise<{ content: { text: string }[]; isError?: true }>
}

let store: BoardStore
let registry: BoardRegistry
let tools: Map<string, CapturedTool>
let boardId: string
let columnIds: string[]

function build(projectId: string | null, chatId: string | null = "chat-1") {
  const list = buildBoardToolList({ boardRegistry: registry, chatId, projectId }, (name, _description, _schema, handler) => ({
    name,
    run: handler,
  }))
  tools = new Map(list.map((entry) => [entry.name, entry]))
}

async function call(name: string, input: JsonObject = {}) {
  const entry = tools.get(name)
  if (!entry) throw new Error(`no tool ${name}`)
  return entry.run(input)
}

beforeEach(() => {
  let counter = 0
  store = createBoardStore({
    filePath: ":memory:",
    now: () => 1_700_000_000_000,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  registry = createBoardRegistry({ store })
  const board = registry.createBoard({
    owner: { kind: "project", id: "project-1" },
    title: "Sprint",
    definition: DEFINITION,
  })
  boardId = board.id
  columnIds = store.listColumns(boardId).map((column) => column.id)
  build("project-1")
})

describe("registration", () => {
  test("no tools without a chat, a project, or a registry", () => {
    expect(buildBoardToolList({ boardRegistry: registry, chatId: null, projectId: "p" }, () => ({}))).toEqual([])
    expect(buildBoardToolList({ boardRegistry: registry, chatId: "c", projectId: null }, () => ({}))).toEqual([])
    expect(buildBoardToolList({ chatId: "c", projectId: "p" }, () => ({}))).toEqual([])
  })

  test("registers the five board tools", () => {
    expect([...tools.keys()].sort()).toEqual(["board_get", "board_list", "card_comment", "card_create", "card_move"])
  })
})

describe("project scoping", () => {
  test("a board in ANOTHER project is refused, not read", async () => {
    const foreign = registry.createBoard({ owner: { kind: "project", id: "project-2" }, title: "Theirs" })
    const result = await call("board_get", { board_id: foreign.id })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("another project")
  })

  test("moving a card on another project's board is refused", async () => {
    const foreign = registry.createBoard({
      owner: { kind: "project", id: "project-2" },
      title: "Theirs",
      definition: DEFINITION,
    })
    const foreignColumn = store.listColumns(foreign.id)[0]!
    const card = registry.createCard({
      boardId: foreign.id,
      columnId: foreignColumn.id,
      title: "Theirs",
      actor: { kind: "user" },
    })
    const result = await call("card_move", { card_id: card.id, to_column_id: foreignColumn.id })
    expect(result.isError).toBe(true)
  })

  test("board_list only shows this project's boards", async () => {
    registry.createBoard({ owner: { kind: "project", id: "project-2" }, title: "Theirs" })
    const result = await call("board_list")
    expect(result.content[0]?.text).toContain("Sprint")
    expect(result.content[0]?.text).not.toContain("Theirs")
  })
})

describe("context bounding", () => {
  test("board_get returns a window plus the TOTAL, never the whole column", async () => {
    let previous: string | null = null
    for (let index = 0; index < 55; index += 1) {
      previous = registry.createCard({
        boardId,
        columnId: columnIds[0]!,
        title: `Card ${index}`,
        actor: { kind: "user" },
        afterCardId: previous,
      }).id
    }

    const text = (await call("board_get", { board_id: boardId })).content[0]?.text ?? ""
    expect(text).toContain("55 cards")
    expect(text).toContain("… 35 more")
    expect(text.split("Card ").length - 1).toBe(20)
  })

  test("board_get can focus a single column", async () => {
    const text = (await call("board_get", { board_id: boardId, column_id: columnIds[1] })).content[0]?.text ?? ""
    expect(text).toContain("Doing")
    expect(text).not.toContain("Todo")
  })

  test("an unknown column is an error, not an empty board", async () => {
    const result = await call("board_get", { board_id: boardId, column_id: "nope" })
    expect(result.isError).toBe(true)
  })
})

describe("writes", () => {
  test("a moved card is attributed to the agent", async () => {
    const card = registry.createCard({
      boardId,
      columnId: columnIds[0]!,
      title: "Task",
      actor: { kind: "user" },
    })
    await call("card_move", { card_id: card.id, to_column_id: columnIds[1] })

    const moved = store.getCard(card.id)
    expect(moved?.columnId).toBe(columnIds[1]!)
    expect(moved?.updatedBy).toEqual({ kind: "agent", chatId: "chat-1" })
  })

  test("a created card carries the project so Start work knows the checkout", async () => {
    const result = await call("card_create", { board_id: boardId, column_id: columnIds[0], title: "From agent" })
    expect(result.isError).toBeUndefined()
    const created = store.listCardPage({ columnId: columnIds[0]!, limit: 5 }).cards[0]
    expect(created?.projectId).toBe("project-1")
    expect(created?.updatedBy).toEqual({ kind: "agent", chatId: "chat-1" })
  })

  test("a comment is recorded with the agent as author", async () => {
    const card = registry.createCard({
      boardId,
      columnId: columnIds[0]!,
      title: "Task",
      actor: { kind: "user" },
    })
    await call("card_comment", { card_id: card.id, body: "Fixed the redirect." })
    const comments = store.listComments(card.id)
    expect(comments[0]?.body).toBe("Fixed the redirect.")
    expect(comments[0]?.author).toEqual({ kind: "agent", chatId: "chat-1" })
  })

  test("a store refusal comes back as a tool error, not a thrown exception", async () => {
    const result = await call("card_move", { card_id: "missing", to_column_id: columnIds[0] })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("does not exist")
  })
})

describe("registration reaches the real MCP host", () => {
  test("the board tools appear ONLY when boardRegistry is supplied at the spawn site", async () => {
    const { buildKannaMcpTools } = await import("./kanna-mcp")
    const base = { projectId: "project-1", localPath: "/tmp", chatId: "chat-1" }
    const boardNames = (list: { name?: string }[]) =>
      list.map((entry) => entry.name ?? "").filter((name) => name.startsWith("board_") || name.startsWith("card_"))

    expect(boardNames(buildKannaMcpTools({ ...base }))).toEqual([])
    expect(boardNames(buildKannaMcpTools({ ...base, boardRegistry: registry })).sort()).toEqual([
      "board_get",
      "board_list",
      "card_comment",
      "card_create",
      "card_move",
    ])
  })
})
