import type { CommandPort } from "../ports/commandPort"
import type { ProjectPathEntry } from "../../shared/commands/results/project"

export type ProjectPath = ProjectPathEntry

export const projectQueryKeys = {
  all: ["projects"] as const,
  paths: (projectId: string, query: string) => ["projects", projectId, "paths", query] as const,
}

export async function fetchProjectPaths(
  commands: CommandPort | null,
  projectId: string,
  query: string,
): Promise<ProjectPath[]> {
  if (!commands) return []
  const { paths } = await commands.command({ type: "project.listPaths", projectId, query })
  return paths
}
