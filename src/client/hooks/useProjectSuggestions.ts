import { useMemo } from "react"
import type { SidebarData } from "../../shared/types"
import { PROJECT_MENTION_PREFIX, buildProjectMentionIndex } from "../../shared/project-mention"
import { getPathBasename } from "../lib/formatters"
import { useKannaStateStore } from "../stores/kannaStateStore"

export interface ProjectSuggestion {
  kind: "project"
  projectId: string
  slug: string
  title: string
  localPath: string
}

export interface MentionableProjectRow {
  id: string
  localPath: string
}

const EMPTY_SUGGESTIONS: ProjectSuggestion[] = []

export function projectRowsFromSidebar(sidebarData: SidebarData): MentionableProjectRow[] {
  return [...sidebarData.starredProjectGroups, ...sidebarData.projectGroups].map((group) => ({
    id: group.groupKey,
    localPath: group.localPath,
  }))
}

export function filterProjectSuggestions(
  projects: readonly MentionableProjectRow[],
  query: string,
  excludeProjectId: string | null,
): ProjectSuggestion[] {
  const { slugByProjectId } = buildProjectMentionIndex(projects)
  const normalized = query.toLowerCase()
  const namespaced = normalized.startsWith(PROJECT_MENTION_PREFIX)
  const listsEverything = normalized === "" || PROJECT_MENTION_PREFIX.startsWith(normalized)
  const nameQuery = namespaced ? normalized.slice(PROJECT_MENTION_PREFIX.length) : normalized

  const matches: ProjectSuggestion[] = []
  for (const project of projects) {
    if (project.id === excludeProjectId) continue
    const slug = slugByProjectId.get(project.id)
    if (slug === undefined) continue
    const title = getPathBasename(project.localPath)
    const hit = listsEverything
      || slug.includes(nameQuery)
      || title.toLowerCase().includes(nameQuery)
    if (!hit) continue
    matches.push({ kind: "project", projectId: project.id, slug, title, localPath: project.localPath })
  }
  return matches.sort((left, right) => left.slug.localeCompare(right.slug))
}

export function useProjectSuggestions(args: {
  query: string
  enabled: boolean
  excludeProjectId: string | null
}): { items: ProjectSuggestion[] } {
  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  return useMemo(() => {
    if (!args.enabled) return { items: EMPTY_SUGGESTIONS }
    const projects = projectRowsFromSidebar(sidebarData)
    return { items: filterProjectSuggestions(projects, args.query, args.excludeProjectId) }
  }, [args.enabled, args.query, args.excludeProjectId, sidebarData])
}
