import path from "node:path"
import { isPathInside } from "./path-containment"

export interface ResolvedProjectFilePath {
  relativePath: string
  filePath: string
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
  if (!isPathInside(root, filePath)) return null
  return { relativePath, filePath }
}
