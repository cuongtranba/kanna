import { realpathSync, existsSync } from "node:fs"
import type { GitWorktree } from "../shared/types"
import { runGit, formatGitFailure } from "./diff-store"

// Resolves macOS /var -> /private/var symlinks so git's resolved path matches the caller-supplied one.
function normalizePath(p: string): string {
  return existsSync(p) ? realpathSync(p) : p
}

export function parseWorktreeList(porcelain: string): GitWorktree[] {
  const blocks = porcelain.split(/\r?\n\r?\n/u).map((b) => b.trim()).filter(Boolean)
  const parsed: Array<GitWorktree | null> = blocks.map((block) => {
    const lines = block.split(/\r?\n/u)
    let path = ""
    let head = ""
    let branch = "(detached)"
    let isLocked = false
    let isBare = false
    for (const line of lines) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim()
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim()
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim()
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref
      } else if (line === "detached") branch = "(detached)"
      else if (line === "locked" || line.startsWith("locked ")) isLocked = true
      else if (line === "bare") isBare = true
    }
    if (isBare) return null
    if (path === "") return null
    return { path, sha: head, branch, isPrimary: false, isLocked }
  })
  const filtered = parsed.filter((w): w is GitWorktree => w !== null)
  return filtered.map((w, index) => ({ ...w, isPrimary: index === 0 }))
}

export async function listWorktrees(repoRoot: string): Promise<GitWorktree[]> {
  const result = await runGit(["worktree", "list", "--porcelain"], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git worktree list failed")
  }
  return parseWorktreeList(result.stdout)
}

export type AddWorktreeOpts =
  | { kind: "new-branch"; branch: string; path: string; base?: string }
  | { kind: "existing-branch"; branch: string; path: string }

export async function addWorktree(repoRoot: string, opts: AddWorktreeOpts): Promise<GitWorktree> {
  const args = ["worktree", "add"]
  if (opts.kind === "new-branch") {
    args.push("-b", opts.branch, opts.path)
    if (opts.base) args.push(opts.base)
  } else {
    args.push(opts.path, opts.branch)
  }
  const result = await runGit(args, repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git worktree add failed")
  }
  const list = await listWorktrees(repoRoot)
  // Resolve symlinks before comparing: on macOS, mkdtemp returns /var/... but
  // git resolves /var -> /private/var, so a plain string match would fail.
  const normalized = normalizePath(opts.path)
  const created = list.find((w) => w.path === normalized || w.path === opts.path)
  if (!created) {
    throw new Error(
      `worktree created but not found in list (requested: ${opts.path}, resolved: ${normalized})`
    )
  }
  return created
}
