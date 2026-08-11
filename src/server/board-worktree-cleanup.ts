/**
 * Resolving a card's worktree once the card reaches `done`.
 *
 * The rule this module exists to enforce: Kanna never deletes a worktree that
 * still holds work. A column drag is one gesture with no undo, and uncommitted
 * changes in a worktree exist nowhere else — so `discard` refuses while there
 * is anything to lose and says what, rather than asking "are you sure?".
 *
 * Merging reuses Kanna's existing branch machinery (`previewMergeBranch` /
 * `mergeBranch`), so a card's branch merges by exactly the same rules, and with
 * the same conflict detection, as one merged from the Changes panel.
 *
 * All IO is injected; this module imports none.
 */

import { BoardStoreError } from "./board-store"
import type { BoardRegistry } from "./board-registry"
import { resolveStartWorkProjectId } from "../shared/boards/start-work"
import {
  CLEANUP_DECLINED,
  discardBlockedReason,
  mergeBlockedReason,
  pendingCleanupWorktree,
  type CleanupDecision,
  type WorktreeCleanupView,
} from "../shared/boards/worktree-cleanup"
import { cardBranchName } from "./board-store"
import type { GitWorktree } from "../shared/types"
import type { StartWorkProject } from "./board-start-work"

export interface MergePreview {
  commitCount: number
  hasConflicts: boolean
}

export interface WorktreeCleanupDeps {
  registry: BoardRegistry
  getProject(projectId: string): StartWorkProject | null
  listWorktrees(repoRoot: string): Promise<GitWorktree[]>
  isDirty(worktreePath: string): Promise<{ dirty: boolean; fileCount: number }>
  previewMerge(repoRoot: string, branch: string): Promise<MergePreview>
  mergeBranch(projectId: string, repoRoot: string, branch: string): Promise<{ ok: boolean; message: string }>
  removeWorktree(repoRoot: string, worktreePath: string, opts: { force: boolean }): Promise<void>
}

export type WorktreeCleanupOutcome =
  | { decision: "leave"; worktreePath: string }
  | { decision: "discard"; worktreePath: string }
  | { decision: "merge"; worktreePath: string; message: string }

interface Resolved {
  worktreePath: string
  branch: string
  project: StartWorkProject
}

async function locate(deps: WorktreeCleanupDeps, cardId: string): Promise<Resolved | null> {
  const detail = deps.registry.cardDetail(cardId)
  if (!detail) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)

  const board = deps.registry.getBoard(detail.card.boardId)
  if (!board) throw new BoardStoreError("not_found", `board ${detail.card.boardId} does not exist`)

  const projectId = resolveStartWorkProjectId(detail.card, board)
  if (!projectId) return null
  const project = deps.getProject(projectId)
  if (!project) return null

  const column = deps.registry.listColumns(board.id).find((entry) => entry.id === detail.card.columnId)
  const worktrees = await deps.listWorktrees(project.localPath)
  const worktreePath = pendingCleanupWorktree({
    columnSemantic: column?.semantic ?? null,
    links: detail.links,
    existingWorktreePaths: new Set(worktrees.map((entry) => entry.path)),
  })
  if (!worktreePath) return null

  // The worktree knows its own branch; the derived name is only the fallback
  // for a checkout git reports as detached.
  const branch = worktrees.find((entry) => entry.path === worktreePath)?.branch
  return {
    worktreePath,
    branch:
      branch && branch !== "(detached)"
        ? branch
        : cardBranchName(detail.card.id, detail.card.title, detail.externalRef),
    project,
  }
}

/** What merging would bring, and what discarding would destroy. */
async function price(deps: WorktreeCleanupDeps, found: Resolved): Promise<WorktreeCleanupView> {
  const [dirty, preview] = await Promise.all([
    deps.isDirty(found.worktreePath),
    deps.previewMerge(found.project.localPath, found.branch),
  ])
  return {
    worktreePath: found.worktreePath,
    branch: found.branch,
    dirtyFileCount: dirty.fileCount,
    unmergedCommitCount: preview.commitCount,
    hasConflicts: preview.hasConflicts,
  }
}

/** The pending question, priced. Null when there is nothing to ask. */
export async function worktreeCleanupView(
  deps: WorktreeCleanupDeps,
  cardId: string,
): Promise<WorktreeCleanupView | null> {
  const found = await locate(deps, cardId)
  return found ? await price(deps, found) : null
}

export async function resolveWorktreeCleanup(
  deps: WorktreeCleanupDeps,
  cardId: string,
  decision: CleanupDecision,
): Promise<WorktreeCleanupOutcome> {
  const found = await locate(deps, cardId)
  if (!found) throw new BoardStoreError("not_found", "That card has no worktree awaiting a decision.")
  // Priced again at the moment of acting: the drawer's numbers may be minutes
  // old, and a refusal has to be about the worktree as it is now.
  const view = await price(deps, found)

  switch (decision) {
    case "leave": {
      deps.registry.addCardLink(cardId, CLEANUP_DECLINED, view.worktreePath)
      return { decision, worktreePath: view.worktreePath }
    }

    case "discard": {
      const blocked = discardBlockedReason(view)
      if (blocked) throw new BoardStoreError("conflict", blocked)
      await deps.removeWorktree(found.project.localPath, view.worktreePath, { force: false })
      deps.registry.removeCardLink(cardId, "worktree", view.worktreePath)
      return { decision, worktreePath: view.worktreePath }
    }

    case "merge": {
      const blocked = mergeBlockedReason(view)
      if (blocked) throw new BoardStoreError("conflict", blocked)
      const merged = await deps.mergeBranch(found.project.id, found.project.localPath, view.branch)
      if (!merged.ok) throw new BoardStoreError("conflict", merged.message)
      // Merged work is safe elsewhere, so the checkout has served its purpose.
      // A removal failure must not read as a failed merge — the merge stands.
      await deps.removeWorktree(found.project.localPath, view.worktreePath, { force: false }).catch(() => undefined)
      deps.registry.removeCardLink(cardId, "worktree", view.worktreePath)
      return { decision, worktreePath: view.worktreePath, message: merged.message }
    }
  }
}
