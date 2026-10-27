import type { ChatBranchListEntry } from "../../../shared/types"

export function getIgnoreFolderEntryFromDiffPath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/$/u, "")
  const lastSlashIndex = normalized.lastIndexOf("/")
  if (lastSlashIndex <= 0) {
    return null
  }
  return `${normalized.slice(0, lastSlashIndex)}/`
}

export function serializeBranchSelection(branch: ChatBranchListEntry) {
  if (branch.kind === "local") {
    return { kind: "local" as const, name: branch.name }
  }
  if (branch.kind === "remote") {
    return { kind: "remote" as const, name: branch.name, remoteRef: branch.remoteRef ?? branch.displayName }
  }
  return {
    kind: "pull_request" as const,
    name: branch.name,
    prNumber: branch.prNumber ?? 0,
    headRefName: branch.headRefName ?? branch.name,
    headRepoCloneUrl: branch.headRepoCloneUrl,
    isCrossRepository: branch.isCrossRepository,
    remoteRef: branch.remoteRef,
  }
}

function isAbsoluteLocalPath(value: string) {
  return value.startsWith("/")
    || value === "~"
    || value.startsWith("~/")
    || /^[A-Za-z]:[\\/]/u.test(value)
}

function joinProjectRelativePath(projectPath: string, filePath: string) {
  const separator = projectPath.includes("\\") && !projectPath.includes("/") ? "\\" : "/"
  const normalizedProjectPath = projectPath.replace(/[\\/]+$/u, "")
  const normalizedFilePath = filePath.replace(/^[\\/]+/u, "")
  return `${normalizedProjectPath}${separator}${normalizedFilePath}`
}

export function resolveDiffFilePath(projectPath: string | null, filePath: string) {
  return !projectPath || isAbsoluteLocalPath(filePath)
    ? filePath
    : joinProjectRelativePath(projectPath, filePath)
}
