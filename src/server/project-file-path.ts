import path from "node:path"

export interface ResolvedProjectFilePath {
  relativePath: string
  filePath: string
}

export function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

export function resolveProjectFilePath(projectRoot: string, requestedPath: string): ResolvedProjectFilePath | null {
  const relativePath = path.posix.normalize(requestedPath.replaceAll("\\", "/"))
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../") ||
    path.posix.isAbsolute(relativePath)
  ) {
    return null
  }
  const root = path.resolve(projectRoot)
  const filePath = path.resolve(root, relativePath)
  if (!isWithinRoot(root, filePath)) return null
  return { relativePath, filePath }
}
