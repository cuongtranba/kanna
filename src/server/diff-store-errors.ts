import { summarizeGitFailure } from "./diff-store-io.adapter"
import type { ChatSyncResult, DiffCommitMode, DiffCommitResult } from "../shared/types"

export function createCommitFailure(mode: DiffCommitMode, detail: string): DiffCommitResult {
  const normalized = detail.toLowerCase()
  let title = "Commit failed"
  let message = summarizeGitFailure(detail, "Git could not create the commit.")

  if (normalized.includes("ignored by one of your .gitignore files")) {
    title = "Ignored files cannot be staged"
    message = "One or more selected paths are ignored by .gitignore. Unignore them or remove them from the commit selection."
  }

  return {
    ok: false,
    mode,
    phase: "commit",
    title,
    message,
    detail,
  }
}

export function createPushFailure(mode: DiffCommitMode, detail: string, snapshotChanged: boolean): DiffCommitResult {
  const normalized = detail.toLowerCase()
  let title = "Push failed"
  let message = summarizeGitFailure(detail, "Git could not push the commit.")

  if (normalized.includes("non-fast-forward") || normalized.includes("fetch first")) {
    title = "Branch is not up to date"
    message = "Your branch is behind its remote. Pull or rebase, then try pushing again."
  } else if (normalized.includes("does not appear to be a git repository")) {
    title = "No origin remote configured"
    message = "This repository does not have an origin remote configured."
  } else if (normalized.includes("has no upstream branch") || normalized.includes("set-upstream")) {
    title = "No upstream branch configured"
    message = "This branch does not have an upstream remote branch configured yet."
  } else if (normalized.includes("merge conflict") || normalized.includes("resolve conflicts")) {
    title = "Merge conflicts need resolution"
    message = "Git reported conflicts while preparing the push. Resolve them, then try again."
  } else if (normalized.includes("permission denied") || normalized.includes("authentication failed") || normalized.includes("could not read from remote repository")) {
    title = "Remote authentication failed"
    message = "Git could not authenticate with the remote repository."
  }

  return {
    ok: false,
    mode,
    phase: "push",
    title,
    message,
    detail,
    localCommitCreated: true,
    snapshotChanged,
  }
}

export function createSyncPushFailure(detail: string, snapshotChanged: boolean): ChatSyncResult {
  const normalized = detail.toLowerCase()
  let title = "Push failed"
  let message = summarizeGitFailure(detail, "Git could not push this branch.")

  if (normalized.includes("non-fast-forward") || normalized.includes("fetch first")) {
    title = "Branch is not up to date"
    message = "Your branch is behind its remote. Pull or rebase, then try pushing again."
  } else if (normalized.includes("has no upstream branch") || normalized.includes("set-upstream")) {
    title = "No upstream branch configured"
    message = "This branch does not have an upstream remote branch configured yet."
  } else if (normalized.includes("merge conflict") || normalized.includes("resolve conflicts")) {
    title = "Merge conflicts need resolution"
    message = "Git reported conflicts while preparing the push. Resolve them, then try again."
  } else if (normalized.includes("permission denied") || normalized.includes("authentication failed") || normalized.includes("could not read from remote repository")) {
    title = "Remote authentication failed"
    message = "Git could not authenticate with the remote repository."
  }

  return {
    ok: false,
    action: "push",
    title,
    message,
    detail,
    snapshotChanged,
  }
}
