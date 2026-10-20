import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { PROTOCOL_VERSION } from "../shared/types"

export interface ProjectLookup {
  getProject(projectId: string): { id: string; localPath: string } | null | undefined
}

export interface ProjectPathEntry {
  path: string
  kind: "file" | "dir"
}

export type ListProjectPaths = (args: {
  projectId: string
  localPath: string
  query: string
  limit?: number
}) => Promise<ProjectPathEntry[]>

export type DeleteProjectUpload = (args: { localPath: string; storedName: string }) => Promise<boolean>

function isSingleFileName(storedName: string): boolean {
  return storedName !== ""
    && storedName !== "."
    && storedName !== ".."
    && !storedName.includes("/")
    && !storedName.includes("\\")
}

export async function handleProjectPathsCommand(
  store: ProjectLookup,
  listProjectPaths: ListProjectPaths,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (command.type !== "project.listPaths") return false
  const project = store.getProject(command.projectId)
  if (!project) throw new Error("Project not found")
  const paths = await listProjectPaths({
    projectId: project.id,
    localPath: project.localPath,
    query: command.query ?? "",
    limit: command.limit,
  })
  send({ v: PROTOCOL_VERSION, type: "ack", id, result: { paths } })
  return true
}

export async function handleUploadDeleteCommand(
  store: ProjectLookup,
  deleteProjectUpload: DeleteProjectUpload,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (command.type !== "upload.delete") return false
  const project = store.getProject(command.projectId)
  if (!project) throw new Error("Project not found")
  if (!isSingleFileName(command.storedName)) throw new Error("Invalid attachment path")
  const deleted = await deleteProjectUpload({ localPath: project.localPath, storedName: command.storedName })
  send({ v: PROTOCOL_VERSION, type: "ack", id, result: { deleted } })
  return true
}
