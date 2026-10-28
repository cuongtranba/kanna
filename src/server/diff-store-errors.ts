import { summarizeGitFailure } from "./diff-store-io.adapter"
import type { ChatSyncResult, DiffCommitMode, DiffCommitResult } from "../shared/types"

export type GitFailureContext = "commit" | "push" | "pull" | "fetch" | "publish"

interface GitFailureRule {
  contexts: readonly GitFailureContext[]
  patterns: readonly string[]
  title: string
  message: string
}

const REMOTE_CONTEXTS: readonly GitFailureContext[] = ["push", "pull", "fetch", "publish"]

const GIT_FAILURE_RULES: readonly GitFailureRule[] = [
  {
    contexts: ["commit"],
    patterns: ["ignored by one of your .gitignore files"],
    title: "Ignored files cannot be staged",
    message: "One or more selected paths are ignored by .gitignore. Unignore them or remove them from the commit selection.",
  },
  {
    contexts: ["push"],
    patterns: ["non-fast-forward", "fetch first"],
    title: "Branch is not up to date",
    message: "Your branch is behind its remote. Pull or rebase, then try pushing again.",
  },
  {
    contexts: ["push"],
    patterns: ["does not appear to be a git repository"],
    title: "No origin remote configured",
    message: "This repository does not have an origin remote configured.",
  },
  {
    contexts: ["push"],
    patterns: ["has no upstream branch", "set-upstream"],
    title: "No upstream branch configured",
    message: "This branch does not have an upstream remote branch configured yet.",
  },
  {
    contexts: ["push"],
    patterns: ["merge conflict", "resolve conflicts"],
    title: "Merge conflicts need resolution",
    message: "Git reported conflicts while preparing the push. Resolve them, then try again.",
  },
  {
    contexts: ["pull"],
    patterns: ["not possible to fast-forward"],
    title: "Pull requires merge or rebase",
    message: "Your branch cannot be fast-forwarded. Rebase or merge manually, then try again.",
  },
  {
    contexts: REMOTE_CONTEXTS,
    patterns: ["permission denied", "authentication failed", "could not read from remote repository"],
    title: "Remote authentication failed",
    message: "Git could not authenticate with the remote repository.",
  },
]

const DEFAULT_FAILURE_TITLE: Record<GitFailureContext, string> = {
  commit: "Commit failed",
  push: "Push failed",
  pull: "Pull failed",
  fetch: "Fetch failed",
  publish: "Publish branch failed",
}

export function classifyGitFailure(
  detail: string,
  context: GitFailureContext,
  fallbackMessage: string,
): { title: string; message: string } {
  const normalized = detail.toLowerCase()
  const rule = GIT_FAILURE_RULES.find((candidate) =>
    candidate.contexts.includes(context) && candidate.patterns.some((pattern) => normalized.includes(pattern)))
  if (rule) return { title: rule.title, message: rule.message }
  return { title: DEFAULT_FAILURE_TITLE[context], message: summarizeGitFailure(detail, fallbackMessage) }
}

export function createCommitFailure(mode: DiffCommitMode, detail: string): DiffCommitResult {
  return {
    ok: false,
    mode,
    phase: "commit",
    ...classifyGitFailure(detail, "commit", "Git could not create the commit."),
    detail,
  }
}

export function createPushFailure(mode: DiffCommitMode, detail: string, snapshotChanged: boolean): DiffCommitResult {
  return {
    ok: false,
    mode,
    phase: "push",
    ...classifyGitFailure(detail, "push", "Git could not push the commit."),
    detail,
    localCommitCreated: true,
    snapshotChanged,
  }
}

const SYNC_FALLBACK_MESSAGE = {
  push: "Git could not push this branch.",
  pull: "Git could not pull the latest changes.",
  fetch: "Git could not fetch the latest changes.",
  publish: "Git could not publish this branch.",
} as const satisfies Record<Exclude<GitFailureContext, "commit">, string>

export function createSyncFailure(
  action: keyof typeof SYNC_FALLBACK_MESSAGE,
  detail: string,
  snapshotChanged: boolean,
): ChatSyncResult {
  return {
    ok: false,
    action,
    ...classifyGitFailure(detail, action, SYNC_FALLBACK_MESSAGE[action]),
    detail,
    snapshotChanged,
  }
}
