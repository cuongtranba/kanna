export const PROJECT_MENTION_PREFIX = "project/"

export const PROJECT_MENTION_PATTERN = "(^|[\\s\\n\\t])@project/([A-Za-z0-9][A-Za-z0-9._-]*)"

export function createProjectMentionRegex(): RegExp {
  return new RegExp(PROJECT_MENTION_PATTERN, "g")
}

export interface MentionableProject {
  id: string
  localPath: string
}

export interface ProjectMentionIndex {
  slugByProjectId: ReadonlyMap<string, string>
  projectIdBySlug: ReadonlyMap<string, string>
}

export interface ProjectMentionResolution {
  projectIds: string[]
  unresolvedSlugs: string[]
}

const INVALID_SLUG_CHARS = /[^a-z0-9._-]+/g
const EDGE_DASHES = /^-+|-+$/g

export function normalizeProjectSlugSegment(segment: string): string {
  return segment.toLowerCase().replace(INVALID_SLUG_CHARS, "-").replace(EDGE_DASHES, "")
}

function slugSegments(localPath: string): string[] {
  return localPath
    .split("/")
    .map(normalizeProjectSlugSegment)
    .filter((segment) => segment.length > 0)
}

function candidateSlugs(localPath: string): string[] {
  const segments = slugSegments(localPath)
  const base = segments[segments.length - 1]
  if (base === undefined) return []
  const parent = segments[segments.length - 2]
  return parent === undefined ? [base] : [base, `${parent}-${base}`]
}

function firstFreeSlug(
  candidates: readonly string[],
  startIndex: number,
  taken: ReadonlyMap<string, string>,
): string {
  for (let i = startIndex; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (candidate !== undefined && !taken.has(candidate)) return candidate
  }
  const fallback = candidates[candidates.length - 1] ?? ""
  let suffix = 2
  while (taken.has(`${fallback}-${suffix}`)) suffix++
  return `${fallback}-${suffix}`
}

export function buildProjectMentionIndex(
  projects: readonly MentionableProject[],
): ProjectMentionIndex {
  const ordered = [...projects].sort((left, right) => left.id.localeCompare(right.id))
  const entries = ordered.map((project) => ({
    project,
    candidates: candidateSlugs(project.localPath),
  }))

  const baseCounts = new Map<string, number>()
  for (const entry of entries) {
    const base = entry.candidates[0]
    if (base === undefined) continue
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }

  const slugByProjectId = new Map<string, string>()
  const projectIdBySlug = new Map<string, string>()
  for (const entry of entries) {
    const base = entry.candidates[0]
    if (base === undefined) continue
    const startIndex = (baseCounts.get(base) ?? 0) > 1 ? 1 : 0
    const slug = firstFreeSlug(entry.candidates, startIndex, projectIdBySlug)
    slugByProjectId.set(entry.project.id, slug)
    projectIdBySlug.set(slug, entry.project.id)
  }

  return { slugByProjectId, projectIdBySlug }
}

export function parseProjectMentionSlugs(text: string): string[] {
  const slugs: string[] = []
  for (const match of text.matchAll(createProjectMentionRegex())) {
    const slug = match[2]
    if (slug !== undefined) slugs.push(slug.toLowerCase())
  }
  return slugs
}

function buildUniqueBasenameIndex(
  projects: readonly MentionableProject[],
): Map<string, string | null> {
  const byBase = new Map<string, string | null>()
  for (const project of projects) {
    const base = candidateSlugs(project.localPath)[0]
    if (base === undefined) continue
    byBase.set(base, byBase.has(base) ? null : project.id)
  }
  return byBase
}

export function resolveProjectMentionSlugs(
  slugs: readonly string[],
  projects: readonly MentionableProject[],
): ProjectMentionResolution {
  if (slugs.length === 0) return { projectIds: [], unresolvedSlugs: [] }

  const { projectIdBySlug } = buildProjectMentionIndex(projects)
  const byBase = buildUniqueBasenameIndex(projects)

  const projectIds: string[] = []
  const unresolvedSlugs: string[] = []
  const seen = new Set<string>()
  for (const slug of slugs) {
    const projectId = projectIdBySlug.get(slug) ?? byBase.get(slug) ?? null
    if (projectId === null) {
      if (!unresolvedSlugs.includes(slug)) unresolvedSlugs.push(slug)
      continue
    }
    if (seen.has(projectId)) continue
    seen.add(projectId)
    projectIds.push(projectId)
  }
  return { projectIds, unresolvedSlugs }
}

export function resolveProjectMentions(
  text: string,
  projects: readonly MentionableProject[],
): ProjectMentionResolution {
  return resolveProjectMentionSlugs(parseProjectMentionSlugs(text), projects)
}
