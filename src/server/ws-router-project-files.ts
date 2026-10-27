import { projectNotFound } from "../shared/errors"
import type { ProjectPathEntry } from "../shared/commands/results/project"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { isSafeStoredName } from "./uploads"
import { ackResult } from "./ws-router-ack"

export type { ProjectPathEntry }

export interface ProjectLookup {
  getProject(projectId: string): { id: string; localPath: string } | null | undefined
}

export type ListProjectPaths = (args: {
  projectId: string
  localPath: string
  query: string
  limit?: number
}) => Promise<ProjectPathEntry[]>

export type DeleteProjectUpload = (args: { localPath: string; storedName: string }) => Promise<boolean>

export async function handleProjectPathsCommand(
  store: ProjectLookup,
  listProjectPaths: ListProjectPaths,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (command.type !== "project.listPaths") return false
  const project = store.getProject(command.projectId)
  if (!project) throw projectNotFound()
  const paths = await listProjectPaths({
    projectId: project.id,
    localPath: project.localPath,
    query: command.query ?? "",
    limit: command.limit,
  })
  send(ackResult(id, command, { paths }))
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
  if (!project) throw projectNotFound()
  if (!isSafeStoredName(command.storedName)) throw new Error("Invalid attachment path")
  const deleted = await deleteProjectUpload({ localPath: project.localPath, storedName: command.storedName })
  send(ackResult(id, command, { deleted }))
  return true
}
