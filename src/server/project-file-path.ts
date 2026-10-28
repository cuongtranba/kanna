import path from "node:path"
import { statPathOrNull } from "./fs-stat.adapter"
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

export type ExistingProjectFile =
  | { ok: true; relativePath: string; absolutePath: string; size: number }
  | { ok: false; error: string }

export async function resolveExistingProjectFile(
  projectRoot: string,
  rawPath: string,
): Promise<ExistingProjectFile> {
  const requested = rawPath.trim()
  if (!requested) return { ok: false, error: "path is required" }
  const resolved = resolveProjectFilePath(projectRoot, requested)
  if (!resolved) return { ok: false, error: `Invalid project file path: ${rawPath}` }
  const info = await statPathOrNull(resolved.filePath)
  if (!info) return { ok: false, error: `File not found: ${resolved.relativePath}` }
  if (!info.isFile()) return { ok: false, error: `Not a file: ${resolved.relativePath}` }
  return {
    ok: true,
    relativePath: resolved.relativePath,
    absolutePath: resolved.filePath,
    size: info.size,
  }
}
