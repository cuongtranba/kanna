import { buildRoutePath, HTTP_ROUTES } from "./http-routes"

export function buildProjectFileContentUrl(
  projectId: string | null | undefined,
  relativePath: string | null | undefined,
): string | null {
  if (!projectId || !relativePath) return null
  return buildRoutePath(HTTP_ROUTES.projectFileContent.path, { projectId, filePath: relativePath })
}

export function buildLocalFileContentUrl(absolutePath: string): string {
  return `${HTTP_ROUTES.localFile.path}?path=${encodeURIComponent(absolutePath)}`
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

export function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_PATH.test(value)
}

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
