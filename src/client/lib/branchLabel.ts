import { fileNameOfPath, shortenHomePath } from "./pathUtils"

export interface BranchLabelInput {
  hasGitRepo?: boolean
  gitStatus?: "unknown" | "ready" | "no_repo"
  localPath?: string
  branchName?: string
  homeDir?: string
}

function displayPath(localPath: string, homeDir?: string): string {
  return homeDir ? shortenHomePath(localPath, homeDir) : fileNameOfPath(localPath)
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
