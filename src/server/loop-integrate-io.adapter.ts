import { tryRunGit } from "./git-runner.adapter"

export interface MergeOutcome {
  ok: boolean
  conflicts: readonly string[]
  detail: string
}

function conflictPathsFromMergeTree(stdout: string): string[] {
  const marker = stdout.indexOf("\0")
  const body = marker >= 0 ? stdout.slice(marker + 1) : stdout
  const paths = new Set<string>()
  for (const line of body.split(/[\n\0]/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = /^(?:CONFLICT \([^)]*\): )?(.*)$/.exec(trimmed)
    if (match?.[1]) paths.add(match[1])
  }
  return [...paths]
}

export async function previewLoopMerge(workdir: string, branch: string): Promise<MergeOutcome | null> {
  const preview = await tryRunGit(["merge-tree", "--write-tree", "--name-only", "HEAD", branch], workdir)
  if (!preview) return null
  if (preview.exitCode === 0) return { ok: true, conflicts: [], detail: "" }
  if (preview.exitCode !== 1) {
    return { ok: false, conflicts: [], detail: preview.stderr.trim() || preview.stdout.trim() }
  }
  const conflicts = conflictPathsFromMergeTree(preview.stdout)
  return {
    ok: false,
    conflicts,
    detail: conflicts.length > 0 ? `conflicting paths: ${conflicts.join(", ")}` : "merge conflict",
  }
}

export async function mergeLoopBranch(workdir: string, branch: string): Promise<MergeOutcome> {
  const exists = await tryRunGit(["rev-parse", "--verify", `${branch}^{commit}`], workdir)
  if (!exists || exists.exitCode !== 0) {
    return { ok: false, conflicts: [], detail: `branch ${branch} does not exist` }
  }

  const preview = await previewLoopMerge(workdir, branch)
  if (preview && !preview.ok) return preview

  const merged = await tryRunGit(["merge", "--no-edit", branch], workdir)
  if (!merged) return { ok: false, conflicts: [], detail: `git merge ${branch} timed out` }
  if (merged.exitCode === 0) {
    return { ok: true, conflicts: [], detail: merged.stdout.trim() }
  }

  await tryRunGit(["merge", "--abort"], workdir)
  return {
    ok: false,
    conflicts: [],
    detail: (merged.stderr.trim() || merged.stdout.trim()).split("\n").slice(0, 4).join("; "),
  }
}

export async function currentBranchName(workdir: string): Promise<string | null> {
  const result = await tryRunGit(["rev-parse", "--abbrev-ref", "HEAD"], workdir)
  if (!result || result.exitCode !== 0) return null
  const name = result.stdout.trim()
  return name.length > 0 && name !== "HEAD" ? name : null
}
