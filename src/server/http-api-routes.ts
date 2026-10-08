import path from "node:path"
import type { EventStore } from "./event-store"
import { getServerFile, statFile, type ServerStats } from "./server-io.adapter"
import { buildFileResponse } from "./http-file-response"
import { deleteProjectUpload, inferAttachmentContentType, inferProjectFileContentType } from "./uploads"
import { getProjectUploadDir } from "./paths"
import { listProjectPaths } from "./project-paths"
import { log } from "../shared/log"

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
  let info: ServerStats
  try {
    info = await statFile(filePath)
    if (!info.isFile()) return Response.json({ error: "Attachment not found" }, { status: 404 })
  } catch {
    return Response.json({ error: "Attachment not found" }, { status: 404 })
  }

  return buildFileResponse({
    req,
    file,
    size: info.size,
    mtimeMs: info.mtimeMs,
    contentType: inferAttachmentContentType(storedName, file.type),
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
  let info: ServerStats
  try {
    info = await statFile(filePath)
    if (!info.isFile()) return Response.json({ error: "File not found" }, { status: 404 })
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 })
  }

  return buildFileResponse({
    req,
    file,
    size: info.size,
    mtimeMs: info.mtimeMs,
    contentType: inferProjectFileContentType(relativePath, file.type),
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

  let info: ServerStats
  try {
    info = await statFile(absolutePath)
    if (!info.isFile()) return Response.json({ error: "Not a file" }, { status: 404 })
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 })
  }

  const file = getServerFile(absolutePath)
  const fileName = path.basename(absolutePath)
  return buildFileResponse({
    req,
    file,
    size: info.size,
    mtimeMs: info.mtimeMs,
    contentType: inferProjectFileContentType(fileName, file.type),
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
