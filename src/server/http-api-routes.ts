import path from "node:path"
import type { EventStore } from "./event-store"
import { getServerFile, statFile, type ServerStats } from "./server-io.adapter"
import { buildFileResponse } from "./http-file-response"
import { inferAttachmentContentType, inferProjectFileContentType } from "./uploads"
import { getProjectUploadDir } from "./paths"
import { resolveProjectFilePath } from "./project-file-path"

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

  const resolved = resolveProjectFilePath(project.localPath, decodeURIComponent(match[2]))
  if (!resolved) return Response.json({ error: "Invalid project file path" }, { status: 400 })
  const { relativePath, filePath } = resolved

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
