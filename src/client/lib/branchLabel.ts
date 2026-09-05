export interface BranchLabelInput {
  hasGitRepo?: boolean
  gitStatus?: "unknown" | "ready" | "no_repo"
  localPath?: string
  branchName?: string
  homeDir?: string
}

function stripTrailingSep(path: string): string {
  return path.replace(/[/\\]+$/, "")
}

function displayPath(localPath: string, homeDir?: string): string {
  const path = stripTrailingSep(localPath)
  if (!homeDir) {
    return path.split(/[/\\]/).filter(Boolean).pop() ?? ""
  }
  const home = stripTrailingSep(homeDir)
  if (path === home) return "~"
  for (const sep of ["/", "\\"]) {
    if (path.startsWith(home + sep)) {
      return `~/${  path.slice(home.length + 1).replace(/\\/g, "/")}`
    }
  }
  return path
}

export function branchLabel({
  hasGitRepo = true,
  gitStatus = "unknown",
  localPath,
  branchName,
  homeDir,
}: BranchLabelInput): string | null {
  if (!hasGitRepo) return "Setup Git"
  if (gitStatus === "unknown") return null
  const path = localPath ? displayPath(localPath, homeDir) : ""
  const branch = branchName ?? "Detached HEAD"
  return path ? `${path} · ${branch}` : branch
}
