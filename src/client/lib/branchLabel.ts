export interface BranchLabelInput {
  hasGitRepo?: boolean
  gitStatus?: "unknown" | "ready" | "no_repo"
  localPath?: string
  branchName?: string
}

export function branchLabel({
  hasGitRepo = true,
  gitStatus = "unknown",
  localPath,
  branchName,
}: BranchLabelInput): string | null {
  if (!hasGitRepo) return "Setup Git"
  if (gitStatus === "unknown") return null
  const worktreeDir = localPath ? localPath.split(/[/\\]/).filter(Boolean).pop() ?? "" : ""
  const branch = branchName ?? "Detached HEAD"
  return worktreeDir ? `${worktreeDir} · ${branch}` : branch
}
