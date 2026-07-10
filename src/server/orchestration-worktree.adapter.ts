// src/server/orchestration-worktree.adapter.ts
import { mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import type { OrchWorktreeOps } from "./orchestration-queue"
import { addWorktree, listWorktrees, removeWorktree } from "./worktree-store.adapter"
import { commitAll, diffAgainstBase } from "./orchestration-git.adapter"
import { runGit, formatGitFailure } from "./diff-store"

export function createOrchWorktreeOps(): OrchWorktreeOps {
  async function headOf(wtPath: string): Promise<string> {
    const rev = await runGit(["rev-parse", "HEAD"], wtPath)
    if (rev.exitCode !== 0) throw new Error(formatGitFailure(rev) || "git rev-parse HEAD failed")
    return rev.stdout.trim()
  }
  return {
    async ensureWorktree(repoRoot, branch, wtPath, base) {
      if (existsSync(path.join(wtPath, ".git"))) {
        return { path: wtPath, branch, headSha: await headOf(wtPath) }
      }
      const existing = await listWorktrees(repoRoot)
      const byBranch = existing.find((w) => w.branch === branch)
      if (byBranch) return { path: byBranch.path, branch, headSha: await headOf(byBranch.path) }
      mkdirSync(path.dirname(wtPath), { recursive: true })
      const branchProbe = await runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot)
      const created = await addWorktree(
        repoRoot,
        branchProbe.exitCode === 0
          ? { kind: "existing-branch", branch, path: wtPath }
          : { kind: "new-branch", branch, path: wtPath, base },
      )
      return { path: created.path, branch, headSha: await headOf(created.path) }
    },
    async removeWorktree(repoRoot, wtPath) {
      await removeWorktree(repoRoot, wtPath, { force: true })
    },
    commitAll,
    diffAgainstBase,
    async resetHard(wtPath) {
      const reset = await runGit(["reset", "--hard", "HEAD"], wtPath)
      if (reset.exitCode !== 0) throw new Error(formatGitFailure(reset) || "git reset --hard failed")
      const clean = await runGit(["clean", "-fd"], wtPath)
      if (clean.exitCode !== 0) throw new Error(formatGitFailure(clean) || "git clean failed")
    },
  }
}
