import { beforeEach, describe, expect, test } from "bun:test"
import { createBoardRegistry, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { BoardStore } from "./board-store"
import {
  resolveWorktreeCleanup,
  worktreeCleanupView,
  type WorktreeCleanupDeps,
} from "./board-worktree-cleanup"
import { CLEANUP_DECLINED } from "../shared/boards/worktree-cleanup"
import type { BoardTemplateDefinition, Card } from "../shared/boards/types"
import type { GitWorktree } from "../shared/types"

const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
    { title: "Done", semantic: "done", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

const REPO = "/repo/kanna"
const WT = "/repo/.kanna-worktrees/kanna/card-1"

interface Recorder {
  removed: Array<{ path: string; force: boolean }>
  merged: string[]
}

let store: BoardStore
let registry: BoardRegistry
let recorder: Recorder

function worktree(path: string, branch: string): GitWorktree {
  return { path, branch, sha: "abc", isPrimary: false, isLocked: false }
}

function makeDeps(overrides: Partial<WorktreeCleanupDeps> = {}): WorktreeCleanupDeps {
  return {
    registry,
    getProject: (projectId) => (projectId === "project-1" ? { id: projectId, localPath: REPO } : null),
    listWorktrees: () => Promise.resolve([worktree(REPO, "main"), worktree(WT, "card/1-task")]),
    isDirty: () => Promise.resolve({ dirty: false, fileCount: 0 }),
    previewMerge: () => Promise.resolve({ commitCount: 2, hasConflicts: false }),
    mergeBranch: (_projectId, _repoRoot, branch) => {
      recorder.merged.push(branch)
      return Promise.resolve({ ok: true, message: "Merged 2 commits" })
    },
    removeWorktree: (_repoRoot, path, opts) => {
      recorder.removed.push({ path, force: opts.force })
      return Promise.resolve()
    },
    ...overrides,
  }
}

function seed(): { card: Card; doneColumnId: string } {
  let counter = 0
  store = createBoardStore({
    filePath: ":memory:",
    now: () => 1_700_000_000_000,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  registry = createBoardRegistry({ store })
  recorder = { removed: [], merged: [] }

  const board = registry.createBoard({
    owner: { kind: "project", id: "project-1" },
    title: "Sprint",
    definition: DEFINITION,
  })
  const columns = registry.listColumns(board.id)
  const card = registry.createCard({
    boardId: board.id,
    columnId: columns[1]!.id,
    title: "Task",
    actor: { kind: "user" },
  })
  registry.addCardLink(card.id, "worktree", WT)
  return { card, doneColumnId: columns[1]!.id }
}

beforeEach(() => {
  seed()
})

describe("worktreeCleanupView", () => {
  test("prices the question: what merging brings, what discarding destroys", async () => {
    const { card } = seed()
    const view = await worktreeCleanupView(
      makeDeps({ isDirty: () => Promise.resolve({ dirty: true, fileCount: 3 }) }),
      card.id,
    )
    expect(view).toEqual({
      worktreePath: WT,
      branch: "card/1-task",
      dirtyFileCount: 3,
      unmergedCommitCount: 2,
      hasConflicts: false,
    })
  })

  test("no question for a card that is not done", async () => {
    const { card } = seed()
    const columns = registry.listColumns(card.boardId)
    registry.moveCard({
      cardId: card.id,
      toColumnId: columns[0]!.id,
      aboveCardId: null,
      belowCardId: null,
      actor: { kind: "user" },
    })
    expect(await worktreeCleanupView(makeDeps(), card.id)).toBeNull()
  })
})

describe("resolveWorktreeCleanup", () => {
  test("leave keeps everything and is not asked again", async () => {
    const { card } = seed()
    const deps = makeDeps()

    await resolveWorktreeCleanup(deps, card.id, "leave")

    expect(recorder.removed).toEqual([])
    expect(registry.cardDetail(card.id)!.links.some((link) => link.kind === CLEANUP_DECLINED)).toBe(true)
    expect(await worktreeCleanupView(deps, card.id)).toBeNull()
  })

  test("discard removes a spent worktree and unlinks it", async () => {
    const { card } = seed()
    const deps = makeDeps({ previewMerge: () => Promise.resolve({ commitCount: 0, hasConflicts: false }) })

    await resolveWorktreeCleanup(deps, card.id, "discard")

    expect(recorder.removed).toEqual([{ path: WT, force: false }])
    expect(registry.cardDetail(card.id)!.links.some((link) => link.kind === "worktree")).toBe(false)
  })

  /**
   * The rule the whole module exists for. Uncommitted work in a worktree
   * exists nowhere else, and a column drag must not be able to end it.
   */
  test("discard refuses while the worktree still holds work", async () => {
    const { card } = seed()

    await expect(
      resolveWorktreeCleanup(
        makeDeps({ isDirty: () => Promise.resolve({ dirty: true, fileCount: 2 }) }),
        card.id,
        "discard",
      ),
    ).rejects.toThrow(/2 uncommitted files/u)

    // Unmerged commits block it too, with nothing uncommitted.
    await expect(resolveWorktreeCleanup(makeDeps(), card.id, "discard")).rejects.toThrow(/2 commits/u)

    expect(recorder.removed).toEqual([])
  })

  test("merge merges the card's own branch, then retires the worktree", async () => {
    const { card } = seed()
    const outcome = await resolveWorktreeCleanup(makeDeps(), card.id, "merge")

    expect(recorder.merged).toEqual(["card/1-task"])
    expect(recorder.removed).toEqual([{ path: WT, force: false }])
    expect(outcome).toEqual({ decision: "merge", worktreePath: WT, message: "Merged 2 commits" })
    expect(registry.cardDetail(card.id)!.links.some((link) => link.kind === "worktree")).toBe(false)
  })

  test("merge refuses on conflicts and on uncommitted changes, and merges nothing", async () => {
    const { card } = seed()

    await expect(
      resolveWorktreeCleanup(
        makeDeps({ previewMerge: () => Promise.resolve({ commitCount: 2, hasConflicts: true }) }),
        card.id,
        "merge",
      ),
    ).rejects.toThrow(/conflicts/u)

    await expect(
      resolveWorktreeCleanup(
        makeDeps({ isDirty: () => Promise.resolve({ dirty: true, fileCount: 1 }) }),
        card.id,
        "merge",
      ),
    ).rejects.toThrow(/Commit or discard/u)

    expect(recorder.merged).toEqual([])
  })

  /** A merge that succeeded is not undone by a checkout that would not go. */
  test("a failed removal does not turn a successful merge into a failure", async () => {
    const { card } = seed()
    const outcome = await resolveWorktreeCleanup(
      makeDeps({ removeWorktree: () => Promise.reject(new Error("worktree is locked")) }),
      card.id,
      "merge",
    )
    expect(outcome.decision).toBe("merge")
    expect(registry.cardDetail(card.id)!.links.some((link) => link.kind === "worktree")).toBe(false)
  })

  test("a failed merge leaves the worktree alone", async () => {
    const { card } = seed()
    await expect(
      resolveWorktreeCleanup(
        makeDeps({ mergeBranch: () => Promise.resolve({ ok: false, message: "merge failed: unrelated histories" }) }),
        card.id,
        "merge",
      ),
    ).rejects.toThrow(/unrelated histories/u)
    expect(recorder.removed).toEqual([])
    expect(registry.cardDetail(card.id)!.links.some((link) => link.kind === "worktree")).toBe(true)
  })

  test("refuses when there is nothing to decide", async () => {
    const { card } = seed()
    await expect(
      resolveWorktreeCleanup(makeDeps({ listWorktrees: () => Promise.resolve([worktree(REPO, "main")]) }), card.id, "discard"),
    ).rejects.toThrow(/no worktree awaiting/u)
  })
})
