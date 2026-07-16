/**
 * api/projects.ts — React Query queryFn wrappers for project-related endpoints.
 *
 * Covers:
 *   GET /api/projects/:projectId/paths?query=... — file/dir path autocomplete
 *
 * Consumed by src/client/hooks/useMentionSuggestions.ts (the @-mention
 * autocomplete hook), which re-exports ProjectPath for its existing callers.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"

export interface ProjectPath {
  path: string
  kind: "file" | "dir"
}

interface ProjectPathsApiResponse {
  paths?: ProjectPath[]
}

export const projectQueryKeys = {
  all: ["projects"] as const,
  paths: (projectId: string, query: string) => ["projects", projectId, "paths", query] as const,
}

/**
 * Fetch file/directory path suggestions for @-mention autocomplete.
 * Returns an empty array on any network or server error (graceful degradation).
 */
export async function fetchProjectPaths(
  projectId: string,
  query: string,
  options: { signal?: AbortSignal; http?: HttpPort } = {},
): Promise<ProjectPath[]> {
  const http = options.http ?? httpAdapter
  const params = new URLSearchParams({ query })
  try {
    const result = await http.getJson<ProjectPathsApiResponse>(
      `/api/projects/${encodeURIComponent(projectId)}/paths?${params.toString()}`,
      { signal: options.signal },
    )
    if (!result.ok) return []
    return result.data.paths ?? []
  } catch {
    return []
  }
}
