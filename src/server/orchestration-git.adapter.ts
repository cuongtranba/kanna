import { runGit, formatGitFailure } from "./diff-store"

export type CommitAllResult =
  | { kind: "committed"; sha: string }
  | { kind: "noChanges" }

export async function commitAll(worktreePath: string, message: string): Promise<CommitAllResult> {
  const status = await runGit(["status", "--porcelain", "-z"], worktreePath)
  if (status.exitCode !== 0) throw new Error(formatGitFailure(status) || "git status failed")
  if (status.stdout.length === 0) return { kind: "noChanges" }
  const add = await runGit(["add", "-A"], worktreePath)
  if (add.exitCode !== 0) throw new Error(formatGitFailure(add) || "git add failed")
  const commit = await runGit(["commit", "-m", message], worktreePath)
  if (commit.exitCode !== 0) throw new Error(formatGitFailure(commit) || "git commit failed")
  const rev = await runGit(["rev-parse", "HEAD"], worktreePath)
  if (rev.exitCode !== 0) throw new Error(formatGitFailure(rev) || "git rev-parse failed")
  return { kind: "committed", sha: rev.stdout.trim() }
}

export async function diffAgainstBase(worktreePath: string, baseBranch: string): Promise<string> {
  const staged = await runGit(["add", "-A", "--intent-to-add"], worktreePath)
  if (staged.exitCode !== 0) throw new Error(formatGitFailure(staged) || "git add -N failed")
  const diff = await runGit(["diff", baseBranch], worktreePath)
  if (diff.exitCode !== 0) throw new Error(formatGitFailure(diff) || "git diff failed")
  return diff.stdout
}
