import { describe, expect, test } from "bun:test"
import {
  CLEANUP_DECLINED,
  discardBlockedReason,
  mergeBlockedReason,
  pendingCleanupWorktree,
  type WorktreeCleanupView,
} from "./worktree-cleanup"
import type { CardLink } from "./types"

function link(kind: CardLink["kind"], targetId: string, createdAt = 1): CardLink {
  return { cardId: "card-1", kind, targetId, createdAt }
}

const WT = "/wt/card-1"
const ON_DISK: ReadonlySet<string> = new Set([WT])

function view(overrides: Partial<WorktreeCleanupView> = {}): WorktreeCleanupView {
  return {
    worktreePath: WT,
    branch: "card/412-fix",
    dirtyFileCount: 0,
    unmergedCommitCount: 2,
    hasConflicts: false,
    ...overrides,
  }
}

describe("pendingCleanupWorktree", () => {
  test("a card in done with a live worktree is the question", () => {
    expect(
      pendingCleanupWorktree({
        columnSemantic: "done",
        links: [link("worktree", WT)],
        existingWorktreePaths: ON_DISK,
      }),
    ).toBe(WT)
  })

  test("no question anywhere but done", () => {
    for (const semantic of ["start", "active", "review", null] as const) {
      expect(
        pendingCleanupWorktree({
          columnSemantic: semantic,
          links: [link("worktree", WT)],
          existingWorktreePaths: ON_DISK,
        }),
      ).toBeNull()
    }
  })

  test("a decline is remembered", () => {
    expect(
      pendingCleanupWorktree({
        columnSemantic: "done",
        links: [link("worktree", WT), link(CLEANUP_DECLINED, WT, 2)],
        existingWorktreePaths: ON_DISK,
      }),
    ).toBeNull()
  })

  /** The old answer was about the old checkout. */
  test("a later worktree is asked about again", () => {
    expect(
      pendingCleanupWorktree({
        columnSemantic: "done",
        links: [link("worktree", WT), link(CLEANUP_DECLINED, WT, 2), link("worktree", "/wt/card-1-2", 3)],
        existingWorktreePaths: new Set([WT, "/wt/card-1-2"]),
      }),
    ).toBe("/wt/card-1-2")
  })

  test("a worktree already gone is nothing to ask about", () => {
    expect(
      pendingCleanupWorktree({
        columnSemantic: "done",
        links: [link("worktree", WT)],
        existingWorktreePaths: new Set(),
      }),
    ).toBeNull()
  })
})

describe("discardBlockedReason", () => {
  test("a spent worktree can go", () => {
    expect(discardBlockedReason(view({ unmergedCommitCount: 0 }))).toBeNull()
  })

  test("names what would be lost, singular and plural", () => {
    expect(discardBlockedReason(view({ dirtyFileCount: 1, unmergedCommitCount: 0 }))).toBe(
      "That worktree still holds 1 uncommitted file.",
    )
    expect(discardBlockedReason(view({ dirtyFileCount: 0, unmergedCommitCount: 1 }))).toBe(
      "That worktree still holds 1 commit that is not on the project's branch.",
    )
    expect(discardBlockedReason(view({ dirtyFileCount: 3, unmergedCommitCount: 2 }))).toBe(
      "That worktree still holds 3 uncommitted files and 2 commits that are not on the project's branch.",
    )
  })
})

describe("mergeBlockedReason", () => {
  test("a clean branch with commits merges", () => {
    expect(mergeBlockedReason(view())).toBeNull()
  })

  test("uncommitted work, conflicts and nothing-to-do each say which", () => {
    expect(mergeBlockedReason(view({ dirtyFileCount: 1 }))).toMatch(/Commit or discard/u)
    expect(mergeBlockedReason(view({ hasConflicts: true }))).toMatch(/conflicts/u)
    expect(mergeBlockedReason(view({ unmergedCommitCount: 0 }))).toMatch(/already on/u)
  })
})
