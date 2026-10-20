import type { CommandPort } from "../ports/commandPort"
import { isJsonArray, isJsonObject, type JsonValue } from "../../shared/json"

export interface ProjectPath {
  path: string
  kind: "file" | "dir"
}

export const projectQueryKeys = {
  all: ["projects"] as const,
  paths: (projectId: string, query: string) => ["projects", projectId, "paths", query] as const,
}

function readProjectPath(value: JsonValue): ProjectPath | null {
  if (!isJsonObject(value)) return null
  const { path, kind } = value
  if (typeof path !== "string") return null
  if (kind !== "file" && kind !== "dir") return null
  return { path, kind }
}

export function readProjectPaths(result: JsonValue): ProjectPath[] {
  if (!isJsonObject(result) || !isJsonArray(result.paths)) return []
  return result.paths.flatMap((entry) => {
    const parsed = readProjectPath(entry)
    return parsed ? [parsed] : []
  })
}

export async function fetchProjectPaths(
  commands: CommandPort | null,
  projectId: string,
  query: string,
): Promise<ProjectPath[]> {
  if (!commands) return []
  return readProjectPaths(await commands.command({ type: "project.listPaths", projectId, query }))
}
