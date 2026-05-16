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
