export function buildProjectFileContentUrl(
  projectId: string | null | undefined,
  relativePath: string | null | undefined,
): string | null {
  if (!projectId || !relativePath) return null
  const encodedPath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodedPath}/content`
}

export function buildLocalFileContentUrl(absolutePath: string): string {
  return `/api/local-file?path=${encodeURIComponent(absolutePath)}`
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

export function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_PATH.test(value)
}

/**
 * Pick the right content URL for a file path. Absolute paths cannot be project-relative,
 * so they route through `/api/local-file`. Relative paths go through the project route.
 */
export function buildContentUrlForFilePath(
  projectId: string | null | undefined,
  filePath: string | null | undefined,
): string | null {
  if (!filePath) return null
  if (isAbsoluteFilePath(filePath)) {
    return buildLocalFileContentUrl(filePath)
  }
  return buildProjectFileContentUrl(projectId, filePath)
}
