import { beforeEach, describe, expect, test } from "bun:test"
import { createBoardRegistry, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { BoardStore } from "./board-store"
import { cardWorktreeDir, startWork, startWorkView, type StartWorkDeps } from "./board-start-work"
import type { BoardTemplateDefinition } from "../shared/boards/types"
import type { GitWorktree, StackBinding } from "../shared/types"
import type { AddWorktreeOpts } from "./worktree-store.adapter"

const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: null, wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
    { title: "Done", semantic: "done", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

/** A stage between `active` and `done` — the only shape that advances anywhere. */
const PIPELINE: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: null, wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
    { title: "Test", semantic: null, colorToken: null, wipLimit: null },
    { title: "Done", semantic: "done", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

const NO_SEMANTICS: BoardTemplateDefinition = {
  columns: [
    { title: "Inbox", semantic: null, colorToken: null, wipLimit: null },
    { title: "Shipped", semantic: null, colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

const REPO = "/repo/kanna"

interface Recorder {
  added: AddWorktreeOpts[]
  chats: Array<{ projectId: string; bindings: StackBinding[] }>
  prompts: Array<{ chatId: string; content: string }>
}

let store: BoardStore
let registry: BoardRegistry
let recorder: Recorder

function worktree(path: string, branch: string): GitWorktree {
  return { path, branch, sha: "abc", isPrimary: false, isLocked: false }
}

function makeDeps(overrides: Partial<StartWorkDeps> = {}): StartWorkDeps {
  return {
    registry,
    getProject: (projectId) => (projectId === "project-1" ? { id: projectId, localPath: REPO } : null),
    chatExists: () => false,
    listWorktrees: () => Promise.resolve([worktree(REPO, "main")]),
    localBranchExists: () => Promise.resolve(false),
    addWorktree: (_repoRoot, opts) => {
      recorder.added.push(opts)
      return Promise.resolve(worktree(opts.path, opts.branch))
    },
    createChat: (projectId, options) => {
      recorder.chats.push({ projectId, bindings: options.stackBindings })
      return Promise.resolve({ id: `chat-${recorder.chats.length.toString()}` })
    },
    sendPrompt: (chatId, content) => {
      recorder.prompts.push({ chatId, content })
      return Promise.resolve()
    },
    ...overrides,
  }
}

function seed(definition = DEFINITION) {
  let counter = 0
  store = createBoardStore({
    filePath: ":memory:",
    now: () => 1_700_000_000_000,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  registry = createBoardRegistry({ store })
  recorder = { added: [], chats: [], prompts: [] }

  const board = registry.createBoard({
    owner: { kind: "project", id: "project-1" },
    title: "Sprint",
    definition,
  })
  const columns = registry.listColumns(board.id)
  const card = registry.createCard({
    boardId: board.id,
    columnId: columns[0]!.id,
    title: "Fix: login redirect loop",
    actor: { kind: "user" },
  })
  return { board, columns, card }
}

beforeEach(() => {
  seed()
})

describe("cardWorktreeDir", () => {
  /**
   * Not inside the checkout: a nested worktree shows up as an untracked
   * directory, which would dirty every `git status` the Changes pane and the
   * loop oracle read. Namespaced by repo so two projects cannot collide on a
   * shared parent.
   */
  test("is a sibling of the repo, namespaced by repo name", () => {
    expect(cardWorktreeDir("/repo/kanna")).toBe("../.kanna-worktrees/kanna")
  })
})

describe("startWorkView", () => {
  test("previews the branch and changes nothing", async () => {
    const { card } = seed()
    const view = await startWorkView(makeDeps(), card.id)

    expect(view).toEqual({
      status: { kind: "idle" },
      branch: `card/${card.id.slice(0, 8)}-fix-login-redirect-loop`,
      blockedReason: null,
    })
    expect(recorder.added).toEqual([])
    expect(registry.cardDetail(card.id)!.links).toEqual([])
  })

  /** The drawer has to explain a card it cannot start, so this is not a throw. */
  test("reports a card with no project instead of failing", async () => {
    let counter = 0
    store = createBoardStore({ filePath: ":memory:", now: () => 1, newId: () => `id-${(counter += 1).toString()}` })
    registry = createBoardRegistry({ store })
    recorder = { added: [], chats: [], prompts: [] }
    const board = registry.createBoard({
      owner: { kind: "stack", id: "stack-1" },
      title: "Cross-repo",
      definition: DEFINITION,
    })
    const card = registry.createCard({
      boardId: board.id,
      columnId: registry.listColumns(board.id)[0]!.id,
      title: "Task",
      actor: { kind: "user" },
    })

    const view = await startWorkView(makeDeps(), card.id)
    expect(view.blockedReason).toMatch(/no project/u)
    expect(view.status).toEqual({ kind: "idle" })
  })

  /** The label and the action share one resolver, so they cannot disagree. */
  test("agrees with what startWork then does", async () => {
    const { card } = seed()
    const existing = "/repo/.kanna-worktrees/kanna/card-old"
    registry.addCardLink(card.id, "worktree", existing)
    const deps = makeDeps({
      listWorktrees: () => Promise.resolve([worktree(REPO, "main"), worktree(existing, "card/old")]),
    })

    expect((await startWorkView(deps, card.id)).status).toEqual({ kind: "worktree", worktreePath: existing })
    expect((await startWork(deps, card.id)).worktreePath).toBe(existing)
  })
})

describe("startWork", () => {
  test("creates the branch, worktree, chat and seeded prompt, then moves the card", async () => {
    const { columns, card } = seed()
    const result = await startWork(makeDeps(), card.id)

    expect(result.branch).toBe(`card/${card.id.slice(0, 8)}-fix-login-redirect-loop`)
    expect(recorder.added).toEqual([
      { kind: "new-branch", branch: result.branch, path: result.worktreePath! },
    ])
    // A sibling of the checkout, not a child of it.
    expect(result.worktreePath).toBe(
      `/repo/.kanna-worktrees/kanna/card-${card.id.slice(0, 8)}-fix-login-redirect-loop`,
    )

    // The chat's cwd IS the worktree — that is the whole point of the binding.
    expect(recorder.chats).toEqual([
      {
        projectId: "project-1",
        bindings: [{ projectId: "project-1", worktreePath: result.worktreePath!, role: "primary" }],
      },
    ])
    expect(recorder.prompts[0]!.chatId).toBe(result.chatId)
    expect(recorder.prompts[0]!.content).toContain("Fix: login redirect loop")

    const links = registry.cardDetail(card.id)!.links
    expect(links.map((link) => link.kind).sort()).toEqual(["chat", "worktree"])

    expect(result.movedToColumnId).toBe(columns[1]!.id)
    expect(store.getCard(card.id)!.columnId).toBe(columns[1]!.id)
    expect(result.reused).toBe(false)
  })

  /**
   * The prompt is built AFTER the move, so the column it names is the one after
   * where the card now sits — not the one after where the user left it.
   */
  test("the prompt names the column after the one the card lands in", async () => {
    const { columns, card } = seed(PIPELINE)
    await startWork(makeDeps(), card.id)

    const prompt = recorder.prompts[0]!.content
    expect(prompt).toContain("mcp__kanna__card_move")
    expect(prompt).toContain(`card_id: "${card.id}"`)
    expect(prompt).toContain(`to_column_id: "${columns[2]!.id}"`)
    expect(prompt).toContain("Test")
  })

  /**
   * Closing a card raises the merge/discard/leave question and reports closed to
   * a connected tracker. The agent is never handed that.
   */
  test("the prompt asks for no move when the only next column is done", async () => {
    const { card } = seed()
    await startWork(makeDeps(), card.id)
    expect(recorder.prompts[0]!.content).not.toContain("card_move")
  })

  /** No active column means the card never moved, so it advances from where it is. */
  test("advances from the card's own column when the board marks none active", async () => {
    const { columns, card } = seed(NO_SEMANTICS)
    await startWork(makeDeps(), card.id)
    expect(recorder.prompts[0]!.content).toContain(`to_column_id: "${columns[1]!.id}"`)
  })

  test("uses the tracker's reference in the branch name", async () => {
    const { board, card } = seed()
    const binding = registry.bindSync({
      boardId: board.id,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o", repo: "r" },
      direction: "pull",
      allowAgentPush: false,
    })
    store.upsertSyncLink({
      cardId: card.id,
      bindingId: binding.id,
      externalId: "412",
      externalUrl: null,
      fieldWatermarks: {},
      lastSyncedAt: 0,
    })

    const result = await startWork(makeDeps(), card.id)
    expect(result.branch).toBe("card/412-fix-login-redirect-loop")
  })

  /** No column marked active means the board never said where work goes. */
  test("moves nothing when the board marks no column active", async () => {
    const { columns, card } = seed(NO_SEMANTICS)
    const result = await startWork(makeDeps(), card.id)

    expect(result.movedToColumnId).toBeNull()
    expect(store.getCard(card.id)!.columnId).toBe(columns[0]!.id)
    expect(result.chatId).toBeTruthy()
  })

  test("a card already in the active column is not moved again", async () => {
    const { columns, card } = seed()
    registry.moveCard({
      cardId: card.id,
      toColumnId: columns[1]!.id,
      aboveCardId: null,
      belowCardId: null,
      actor: { kind: "user" },
    })
    const before = store.getCard(card.id)!.rank

    const result = await startWork(makeDeps(), card.id)
    expect(result.movedToColumnId).toBe(columns[1]!.id)
    expect(store.getCard(card.id)!.rank).toBe(before)
  })

  test("resumes into the surviving worktree instead of making a second", async () => {
    const { card } = seed()
    const existing = "/repo/.kanna-worktrees/kanna/card-old"
    registry.addCardLink(card.id, "worktree", existing)

    const result = await startWork(
      makeDeps({ listWorktrees: () => Promise.resolve([worktree(REPO, "main"), worktree(existing, "card/old")]) }),
      card.id,
    )

    expect(recorder.added).toEqual([])
    expect(result.worktreePath).toBe(existing)
    expect(recorder.chats[0]!.bindings[0]!.worktreePath).toBe(existing)
    expect(result.reused).toBe(false)
  })

  test("a live chat is opened, and nothing is created", async () => {
    const { card } = seed()
    registry.addCardLink(card.id, "worktree", "/wt/a")
    registry.addCardLink(card.id, "chat", "chat-live")

    const result = await startWork(
      makeDeps({
        chatExists: (chatId) => chatId === "chat-live",
        listWorktrees: () => Promise.resolve([worktree(REPO, "main"), worktree("/wt/a", "card/a")]),
      }),
      card.id,
    )

    expect(result).toMatchObject({ chatId: "chat-live", reused: true, worktreePath: "/wt/a" })
    expect(recorder.added).toEqual([])
    expect(recorder.chats).toEqual([])
    expect(recorder.prompts).toEqual([])
  })

  /**
   * The worktree was removed but the branch survived. `-b` would fail on the
   * name; reattaching keeps the card's own history instead of minting `-2`.
   */
  test("reattaches an existing branch when its worktree is gone", async () => {
    const { card } = seed()
    const result = await startWork(makeDeps({ localBranchExists: () => Promise.resolve(true) }), card.id)

    expect(recorder.added).toEqual([
      { kind: "existing-branch", branch: result.branch, path: result.worktreePath! },
    ])
  })

  test("refuses a card whose project cannot be resolved", async () => {
    let counter = 0
    store = createBoardStore({
      filePath: ":memory:",
      now: () => 1,
      newId: () => `id-${(counter += 1).toString()}`,
    })
    registry = createBoardRegistry({ store })
    recorder = { added: [], chats: [], prompts: [] }
    const board = registry.createBoard({
      owner: { kind: "stack", id: "stack-1" },
      title: "Cross-repo",
      definition: DEFINITION,
    })
    const card = registry.createCard({
      boardId: board.id,
      columnId: registry.listColumns(board.id)[0]!.id,
      title: "Task",
      actor: { kind: "user" },
    })

    await expect(startWork(makeDeps(), card.id)).rejects.toThrow(/no project/u)
  })

  test("refuses when the project is gone", async () => {
    const { card } = seed()
    await expect(startWork(makeDeps({ getProject: () => null }), card.id)).rejects.toThrow(/project/u)
  })

  test("refuses an unknown card", async () => {
    await expect(startWork(makeDeps(), "missing")).rejects.toThrow(/does not exist/u)
  })

  /**
   * The worktree is linked before the chat exists, so a crash between the two
   * leaves a card that resumes rather than an orphaned checkout nothing knows
   * about.
   */
  test("keeps the worktree link when chat creation fails", async () => {
    const { card } = seed()
    await expect(
      startWork(makeDeps({ createChat: () => Promise.reject(new Error("no auth")) }), card.id),
    ).rejects.toThrow(/no auth/u)

    expect(registry.cardDetail(card.id)!.links.map((link) => link.kind)).toEqual(["worktree"])
  })
})
