import type { GitWorktree } from "../shared/types"

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
