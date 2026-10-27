import path from "node:path"
import type { EventStore } from "./event-store"
import { getServerFile, statFile, type ServerStats } from "./server-io.adapter"
import { buildFileResponse } from "./http-file-response"
import { inferAttachmentContentType, isSafeStoredName } from "./uploads"
import { getProjectUploadDir } from "./paths"
import { resolveProjectFilePath } from "./project-file-path"

function rejectUnlessGetOrHead(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null
  return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
}

async function serveFile(
  req: Request,
  filePath: string,
  errors: { missing: string; notFile: string },
): Promise<Response> {
  let info: ServerStats
  try {
    info = await statFile(filePath)
  } catch {
    return Response.json({ error: errors.missing }, { status: 404 })
  }
  if (!info.isFile()) return Response.json({ error: errors.notFile }, { status: 404 })

  const file = getServerFile(filePath)
  return buildFileResponse({
    req,
    file,
    size: info.size,
    mtimeMs: info.mtimeMs,
    contentType: inferAttachmentContentType(filePath, file.type),
  })
}

export async function handleAttachmentContent(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/uploads\/([^/]+)\/content$/)
  if (!match) return null

  const rejected = rejectUnlessGetOrHead(req)
  if (rejected) return rejected

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const storedName = decodeURIComponent(match[2])
  if (!isSafeStoredName(storedName)) {
    return Response.json({ error: "Invalid attachment path" }, { status: 400 })
  }

  const notFound = "Attachment not found"
  return serveFile(req, path.join(getProjectUploadDir(project.localPath), storedName), { missing: notFound, notFile: notFound })
}

export async function handleProjectFileContent(
  req: Request,
  url: URL,
  store: EventStore,
): Promise<Response | null> {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/(.+)\/content$/)
  if (!match) return null

  const rejected = rejectUnlessGetOrHead(req)
  if (rejected) return rejected

  const project = store.getProject(match[1])
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 })

  const resolved = resolveProjectFilePath(project.localPath, decodeURIComponent(match[2]))
  if (!resolved) return Response.json({ error: "Invalid project file path" }, { status: 400 })

  const notFound = "File not found"
  return serveFile(req, resolved.filePath, { missing: notFound, notFile: notFound })
}

export async function handleLocalFileContent(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== "/api/local-file") return null

  const rejected = rejectUnlessGetOrHead(req)
  if (rejected) return rejected

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

  return serveFile(req, absolutePath, { missing: "File not found", notFile: "Not a file" })
}
