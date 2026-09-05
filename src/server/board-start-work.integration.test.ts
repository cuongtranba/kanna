import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"
import { createBoardRegistry, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import { startWork, startWorkView, type StartWorkDeps } from "./board-start-work"
import { addWorktree, listWorktrees, localBranchExists } from "./worktree-store.adapter"
import { git, makeTempRepo, type TempRepo } from "./test-helpers/worktree-repo"
import { resolveSpawnPaths } from "./claude-session-config"
import type { BoardTemplateDefinition } from "../shared/boards/types"


const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Todo", semantic: "start", colorToken: null, wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

let repo: TempRepo
let dataDir: string
let store: EventStore
let registry: BoardRegistry
let prompts: Array<{ chatId: string; content: string }>

async function setup() {
  repo = makeTempRepo()
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-startwork-"))
  store = new EventStore(dataDir)
  await store.initialize()
  registry = createBoardRegistry({ store: createBoardStore({ filePath: ":memory:" }) })
  prompts = []
}

function deps(): StartWorkDeps {
  return {
    registry,
    getProject: (projectId) => {
      const project = store.getProject(projectId)
      return project ? { id: project.id, localPath: project.localPath } : null
    },
    chatExists: (chatId) => store.getChat(chatId) !== null,
    listWorktrees,
    localBranchExists,
    addWorktree,
    createChat: (projectId, options) => store.createChat(projectId, options),
    sendPrompt: (chatId, content) => {
      prompts.push({ chatId, content })
      return Promise.resolve()
    },
  }
}

async function seedCard(title: string) {
  const project = await store.openProject(repo.dir)
  const board = registry.createBoard({
    owner: { kind: "project", id: project.id },
    title: "Sprint",
    definition: DEFINITION,
  })
  const columns = registry.listColumns(board.id)
  const card = registry.createCard({
    boardId: board.id,
    columnId: columns[0]!.id,
    title,
    actor: { kind: "user" },
  })
  return { project, board, columns, card }
}

beforeEach(setup)

afterEach(() => {
  repo.cleanup()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(path.join(path.dirname(repo.dir), ".kanna-worktrees"), { recursive: true, force: true })
})

test(
  "the worktree lands on disk, the chat resolves its cwd to it, and the checkout stays clean",
  async () => {
    const { project, columns, card } = await seedCard("Fix: login redirect loop")

    const result = await startWork(deps(), card.id)

    expect(existsSync(result.worktreePath!)).toBe(true)
    const worktrees = await listWorktrees(repo.dir)
    const created = worktrees.find((entry) => entry.branch === result.branch)
    expect(created).toBeDefined()
    expect(result.branch).toBe(`card/${card.id.slice(0, 8)}-fix-login-redirect-loop`)

    const chat = store.getChat(result.chatId)!
    expect(chat.stackId).toBeUndefined()
    expect(resolveSpawnPaths(chat, project.localPath).cwd).toBe(created!.path)

    expect(git(repo.dir, "status", "--porcelain")).toBe("")

    const links = registry.cardDetail(card.id)!.links
    expect(links.find((link) => link.kind === "chat")?.targetId).toBe(result.chatId)
    expect(links.find((link) => link.kind === "worktree")?.targetId).toBe(created!.path)
    expect(result.movedToColumnId).toBe(columns[1]!.id)

    expect(prompts[0]!.content).toContain("Fix: login redirect loop")
  },
  60_000,
)

test(
  "a second Start work opens the same chat rather than a second worktree",
  async () => {
    const { card } = await seedCard("Fix: login redirect loop")

    const first = await startWork(deps(), card.id)
    const before = (await listWorktrees(repo.dir)).length

    expect((await startWorkView(deps(), card.id)).status).toEqual({
      kind: "chat",
      chatId: first.chatId,
      worktreePath: first.worktreePath,
    })

    const second = await startWork(deps(), card.id)
    expect(second).toMatchObject({ chatId: first.chatId, reused: true })
    expect((await listWorktrees(repo.dir)).length).toBe(before)
  },
  60_000,
)

test(
  "a card whose worktree was removed by hand reattaches to its own branch",
  async () => {
    const { card } = await seedCard("Fix: login redirect loop")
    const first = await startWork(deps(), card.id)

    git(repo.dir, "worktree", "remove", "--force", first.worktreePath!)
    expect(await localBranchExists(repo.dir, first.branch)).toBe(true)

    const view = await startWorkView(deps(), card.id)
    expect(view.status).toEqual({ kind: "chat", chatId: first.chatId, worktreePath: null })

    await store.deleteChat(first.chatId)
    const again = await startWork(deps(), card.id)
    expect(again.branch).toBe(first.branch)
    expect(existsSync(again.worktreePath!)).toBe(true)
    const branches = git(repo.dir, "branch", "--format=%(refname:short)").split("\n")
    expect(branches.filter((name) => name.startsWith("card/"))).toEqual([first.branch])
  },
  60_000,
)
