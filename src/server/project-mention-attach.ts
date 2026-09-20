import type { StackBinding } from "../shared/types"
import {
  parseProjectMentionSlugs,
  resolveProjectMentionSlugs,
  type MentionableProject,
} from "../shared/project-mention"

export interface MentionedProjectAttachArgs {
  text: string
  chatProjectId: string
  chatLocalPath: string
  currentBindings: readonly StackBinding[] | undefined
  listProjects: () => readonly MentionableProject[]
  pathExists: (path: string) => boolean
}

export function decideMentionedProjectBindings(
  args: MentionedProjectAttachArgs,
): StackBinding[] | null {
  const slugs = parseProjectMentionSlugs(args.text)
  if (slugs.length === 0) return null

  const projects = args.listProjects()
  const { projectIds } = resolveProjectMentionSlugs(slugs, projects)
  if (projectIds.length === 0) return null

  const existing = args.currentBindings ?? []
  const bindings: StackBinding[] = existing.length > 0
    ? existing.map((binding) => ({ ...binding }))
    : [{ projectId: args.chatProjectId, worktreePath: args.chatLocalPath, role: "primary" }]

  const bound = new Set(bindings.map((binding) => binding.projectId))
  const byId = new Map(projects.map((project) => [project.id, project]))

  let added = false
  for (const projectId of projectIds) {
    if (bound.has(projectId)) continue
    const project = byId.get(projectId)
    if (!project) continue
    if (!args.pathExists(project.localPath)) continue
    bindings.push({ projectId, worktreePath: project.localPath, role: "additional" })
    bound.add(projectId)
    added = true
  }

  if (!added) return null
  return bindings
}
