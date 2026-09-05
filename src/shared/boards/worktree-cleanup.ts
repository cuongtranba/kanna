
import type { CardLink, ColumnSemantic } from "./types"

export type CleanupDecision = "merge" | "discard" | "leave"

export const CLEANUP_DECLINED: CardLink["kind"] = "cleanup_declined"

export interface CleanupFacts {
  columnSemantic: ColumnSemantic | null
  links: readonly CardLink[]
  existingWorktreePaths: ReadonlySet<string>
}

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
  dirtyFileCount: number
  unmergedCommitCount: number
  hasConflicts: boolean
}

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
