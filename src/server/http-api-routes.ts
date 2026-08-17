import path from "node:path"
import type { EventStore } from "./event-store"
import type { AppSettingsManager } from "./app-settings"
import { getServerFile, statFile } from "./server-io.adapter"
import { deleteProjectUpload, inferAttachmentContentType, inferProjectFileContentType, persistProjectUpload } from "./uploads"
import { getProjectUploadDir } from "./paths"
import { listProjectPaths } from "./project-paths"
import { log } from "../shared/log"
import type { ChatAttachment } from "../shared/types"

const MAX_UPLOAD_FILES = 50

export async function persistUploadedFiles(args: {
  projectId: string
  localPath: string
  files: File[]
  persistUpload?: typeof persistProjectUpload
}): Promise<ChatAttachment[]> {
  const persist = args.persistUpload ?? persistProjectUpload
  const attachments: ChatAttachment[] = []
  try {
    for (const file of args.files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const attachment = await persist({
        projectId: args.projectId,
        localPath: args.localPath,
        fileName: file.name,
        bytes,
        fallbackMimeType: file.type || undefined,
      })
      attachments.push(attachment)
    }
  } catch (error) {
    await Promise.allSettled(
      attachments.map((attachment) =>
        deleteProjectUpload({ localPath: args.localPath, storedName: path.basename(attachment.absolutePath) })
      )
    )
    throw error
  }
  return attachments
}

export async function handleProjectUpload(
  req: Request,
  url: URL,
  store: EventStore,
  appSettings: AppSettingsManager,
): Promise<Response | null> {
  if (req.method !== "POST") return null

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads$/)
  if (!match) return null

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const formData = await req.formData()
  const files = formData.getAll("files").filter((v): v is File => v instanceof File)

  if (files.length === 0) return Response.json({ error: "No files uploaded" }, { status: 400 })
  if (files.length > MAX_UPLOAD_FILES) {
    return Response.json({ error: `You can upload up to ${MAX_UPLOAD_FILES} files at a time.` }, { status: 400 })
  }

  const { maxFileSizeMb } = appSettings.getSnapshot().uploads
  const maxBytes = maxFileSizeMb * 1024 * 1024
  for (const file of files) {
    if (file.size > maxBytes) {
      return Response.json(
        { error: `File "${file.name}" exceeds the ${maxFileSizeMb} MB limit.` },
        { status: 413 },
      )
    }
  }

  try {
    const attachments = await persistUploadedFiles({ projectId: project.id, localPath: project.localPath, files })
    return Response.json({ attachments })
  } catch (error) {
    log.error("[uploads] Upload failed:", String(error))
    return Response.json({ error: "Upload failed" }, { status: 500 })
  }
}

export async function handleProjectUploadDelete(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  if (req.method !== "DELETE") return null

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)$/)
  if (!match) return null

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const storedName = decodeURIComponent(match[2])
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName === "." || storedName === "..") {
    return Response.json({ error: "Invalid attachment path" }, { status: 400 })
  }

  const deleted = await deleteProjectUpload({ localPath: project.localPath, storedName })
  return Response.json({ ok: deleted })
}

export async function handleAttachmentContent(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)\/content$/)
  if (!match) return null

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const storedName = decodeURIComponent(match[2])
  if (!storedName || storedName.includes("/") || storedName.includes("\\") || storedName === "." || storedName === "..") {
    return Response.json({ error: "Invalid attachment path" }, { status: 400 })
  }

  const filePath = path.join(getProjectUploadDir(project.localPath), storedName)
  const file = getServerFile(filePath)
  let fileSize: number
  try {
    const info = await statFile(filePath)
    if (!info.isFile()) return Response.json({ error: "Attachment not found" }, { status: 404 })
    fileSize = info.size
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  return new Response(req.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": inferAttachmentContentType(storedName, file.type),
      "Content-Length": String(fileSize),
    },
  })
}

export async function handleProjectFileContent(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/(.+)\/content$/)
  if (!match) return null

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const relativePath = path.posix.normalize(decodeURIComponent(match[2]).replaceAll("\\", "/"))
  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../") ||
    path.posix.isAbsolute(relativePath)
  ) {
    return Response.json({ error: "Invalid project file path" }, { status: 400 })
  }

  const filePath = path.resolve(project.localPath, relativePath)
  const projectRoot = path.resolve(project.localPath)
  if (filePath !== projectRoot && !filePath.startsWith(`${projectRoot}${path.sep}`)) {
    return Response.json({ error: "Invalid project file path" }, { status: 400 })
  }

  const file = getServerFile(filePath)
  let fileSize: number
  try {
    const info = await statFile(filePath)
    if (!info.isFile()) return Response.json({ error: "File not found" }, { status: 404 })
    fileSize = info.size
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 })
  }

  return new Response(req.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": inferProjectFileContentType(relativePath, file.type),
      "Content-Length": String(fileSize),
    },
  })
}

export async function handleLocalFileContent(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== "/api/local-file") return null

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  }

  const rawPath = url.searchParams.get("path")
  if (!rawPath) return Response.json({ error: "path query parameter is required" }, { status: 400 })

  let absolutePath: string
  try {
    absolutePath = path.resolve(rawPath)
  } catch {
    return Response.json({ error: "Invalid path" }, { status: 400 })
  }

  if (!path.isAbsolute(absolutePath)) {
    return Response.json({ error: "Path must be absolute" }, { status: 400 })
  }

  let fileSize: number
  try {
    const info = await statFile(absolutePath)
    if (!info.isFile()) return Response.json({ error: "Not a file" }, { status: 404 })
    fileSize = info.size
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 })
  }

  const file = getServerFile(absolutePath)
  const fileName = path.basename(absolutePath)
  return new Response(req.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": inferProjectFileContentType(fileName, file.type),
      "Content-Length": String(fileSize),
    },
  })
}

export async function handleProjectPaths(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  if (req.method !== "GET") return null
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/paths$/)
  if (!match) return null

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const query = url.searchParams.get("query") ?? ""
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw !== null ? Number.parseInt(limitRaw, 10) : undefined

  try {
    const paths = await listProjectPaths({
      projectId: project.id,
      localPath: project.localPath,
      query,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return Response.json({ paths })
  } catch (error) {
    log.error("[paths] list failed:", String(error))
    return Response.json({ error: "Failed to list paths" }, { status: 500 })
  }
}
