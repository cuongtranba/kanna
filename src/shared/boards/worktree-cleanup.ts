/**
 * What to do with a card's worktree once the card reaches `done`.
 *
 * Asked, never performed. A column drag is a one-gesture action with no undo,
 * and an agent's uncommitted work is not recoverable from it — so reaching
 * `done` opens a question and nothing else. Declining is a real answer that is
 * remembered, because a prompt that returns every time trains people to
 * dismiss it without reading.
 */

import type { CardLink, ColumnSemantic } from "./types"

export type CleanupDecision = "merge" | "discard" | "leave"

/**
 * The link kind that records a decline.
 *
 * Keyed by worktree path rather than by card, so starting work again later —
 * a new worktree — asks again. The old answer was about the old checkout.
 */
export const CLEANUP_DECLINED: CardLink["kind"] = "cleanup_declined"

export interface CleanupFacts {
  columnSemantic: ColumnSemantic | null
  links: readonly CardLink[]
  /** Worktree paths that still exist on disk. */
  existingWorktreePaths: ReadonlySet<string>
}

/**
 * The worktree awaiting a decision, or null when there is nothing to ask about.
 *
 * Derived, not event-driven: a card sitting in `done` with a live worktree IS
 * the pending question, however it got there. A missed "moved" event therefore
 * cannot lose the prompt, and a replayed one cannot double it.
 */
export function pendingCleanupWorktree(facts: CleanupFacts): string | null {
  if (facts.columnSemantic !== "done") return null

  const declined = new Set(
    facts.links.filter((link) => link.kind === CLEANUP_DECLINED).map((link) => link.targetId),
  )

  let newest: CardLink | null = null
  for (const link of facts.links) {
    if (link.kind !== "worktree") continue
    if (declined.has(link.targetId)) continue
    if (!facts.existingWorktreePaths.has(link.targetId)) continue
    if (!newest || link.createdAt > newest.createdAt) newest = link
  }
  return newest?.targetId ?? null
}

export interface WorktreeCleanupView {
  worktreePath: string
  branch: string
  /** Uncommitted files in the worktree. */
  dirtyFileCount: number
  /** Commits on the branch the project's current branch cannot reach. */
  unmergedCommitCount: number
  /** Whether merging would conflict, known before the user chooses. */
  hasConflicts: boolean
}

/**
 * Why the worktree must not be deleted, or null when it holds nothing.
 *
 * Both conditions are refusals rather than confirmations. "Are you sure?" is
 * the wrong question when the honest answer is that the work has nowhere else
 * to exist.
 */
export function discardBlockedReason(view: WorktreeCleanupView): string | null {
  const reasons: string[] = []
  if (view.dirtyFileCount > 0) {
    reasons.push(
      view.dirtyFileCount === 1 ? "1 uncommitted file" : `${view.dirtyFileCount.toString()} uncommitted files`,
    )
  }
  if (view.unmergedCommitCount > 0) {
    reasons.push(
      view.unmergedCommitCount === 1
        ? "1 commit that is not on the project's branch"
        : `${view.unmergedCommitCount.toString()} commits that are not on the project's branch`,
    )
  }
  if (reasons.length === 0) return null
  return `That worktree still holds ${reasons.join(" and ")}.`
}

/** Why merging cannot run, or null when it can. */
export function mergeBlockedReason(view: WorktreeCleanupView): string | null {
  if (view.dirtyFileCount > 0) {
    return "Commit or discard the changes in that worktree before merging its branch."
  }
  if (view.hasConflicts) {
    return `Merging ${view.branch} conflicts. Resolve it in the worktree's chat first.`
  }
  if (view.unmergedCommitCount === 0) return "That branch is already on the project's branch."
  return null
}

/**
 * What the worktree is holding, so the choice is made with the numbers in view.
 *
 * Beside {@link discardBlockedReason} and {@link mergeBlockedReason} rather than
 * in the drawer: all three read the same view to answer the same question, and
 * a count the refusal disagreed with would be worse than no count at all.
 */
export function describeWorktreeContents(view: WorktreeCleanupView): string {
  const parts: string[] = []
  if (view.unmergedCommitCount > 0) {
    parts.push(
      view.unmergedCommitCount === 1
        ? "1 commit to merge"
        : `${view.unmergedCommitCount.toString()} commits to merge`,
    )
  }
  if (view.dirtyFileCount > 0) {
    parts.push(
      view.dirtyFileCount === 1
        ? "1 uncommitted file"
        : `${view.dirtyFileCount.toString()} uncommitted files`,
    )
  }
  return parts.length === 0 ? "Nothing left in it." : parts.join(" · ")
}
