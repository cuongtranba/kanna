import { mkdir } from "node:fs/promises"
import path from "node:path"
import { FileStore } from "@tus/file-store"
import { EVENTS, Server, type Upload } from "@tus/server"
import { errorMessage } from "../shared/errors"
import { log } from "../shared/log"
import { getProjectUploadDir } from "./paths"
import { discardPartialUpload, finalizeUploadFromFile } from "./uploads.adapter"

const PARTIAL_DIR_NAME = ".partial"
const PARTIAL_EXPIRATION_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const BYTES_PER_MB = 1024 * 1024
const JSON_CONTENT_TYPE = "application/json"

export interface TusProject {
  id: string
  localPath: string
}

export interface TusUploads {
  handle: (req: Request, projectId: string) => Promise<Response>
}

class TusRejection extends Error {
  constructor(
    readonly status_code: number,
    readonly body: string,
  ) {
    super(body)
    this.name = "TusRejection"
  }
}

interface ProjectTusServer {
  server: Server
  lastSweepAt: number
}

export function tusUploadsPath(projectId: string): string {
  return `/api/projects/${projectId}/uploads/tus`
}

function errorBody(message: string): string {
  return JSON.stringify({ error: message })
}

function metadataValue(upload: Upload, key: string): string | undefined {
  const value = upload.metadata?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function createTusUploads(
  getProject: (projectId: string) => TusProject | null,
  getMaxBytes: () => number,
): TusUploads {
  const servers = new Map<string, Promise<ProjectTusServer>>()

  async function buildServer(project: TusProject): Promise<ProjectTusServer> {
    const partialDir = path.join(getProjectUploadDir(project.localPath), PARTIAL_DIR_NAME)
    await mkdir(partialDir, { recursive: true })

    const server = new Server({
      path: tusUploadsPath(project.id),
      datastore: new FileStore({ directory: partialDir, expirationPeriodInMilliseconds: PARTIAL_EXPIRATION_MS }),
      relativeLocation: true,
      maxSize: () => getMaxBytes(),
      onUploadCreate: async (_req, upload) => {
        if (!metadataValue(upload, "filename")) throw new TusRejection(400, errorBody("Upload filename is required"))
        return {}
      },
      onUploadFinish: async (req, upload) => {
        const fileName = metadataValue(upload, "filename")
        if (!fileName) throw new TusRejection(400, errorBody("Upload filename is required"))
        try {
          const attachment = await finalizeUploadFromFile({
            projectId: project.id,
            localPath: project.localPath,
            sourcePath: path.join(partialDir, upload.id),
            fileName,
            fallbackMimeType: metadataValue(upload, "filetype"),
          })
          return {
            status_code: req.method === "POST" ? 201 : 200,
            headers: { "Content-Type": JSON_CONTENT_TYPE },
            body: JSON.stringify({ attachments: [attachment] }),
          }
        } catch (error) {
          log.error("[uploads] Finalize failed:", errorMessage(error))
          throw new TusRejection(500, errorBody("Upload failed"))
        }
      },
      onResponseError: (_req, err) => {
        if (err instanceof TusRejection) return { status_code: err.status_code, body: err.body }
        const status_code = "status_code" in err ? err.status_code : 500
        if (status_code === 413) {
          const limitMb = Math.round(getMaxBytes() / BYTES_PER_MB)
          return { status_code, body: errorBody(`File exceeds the ${limitMb} MB limit.`) }
        }
        const text = "body" in err ? err.body : err.message
        return { status_code, body: errorBody(text.trim() || "Upload failed") }
      },
    })

    server.on(EVENTS.POST_FINISH, (_req, _res, upload) => {
      discardPartialUpload(path.join(partialDir, upload.id)).catch((error: Error) => {
        log.warn("[uploads] Partial cleanup failed:", errorMessage(error))
      })
    })

    return { server, lastSweepAt: 0 }
  }

  function serverFor(project: TusProject): Promise<ProjectTusServer> {
    const key = `${project.id}\0${project.localPath}`
    const existing = servers.get(key)
    if (existing) return existing
    const created = buildServer(project)
    servers.set(key, created)
    created.catch(() => servers.delete(key))
    return created
  }

  function sweepExpired(entry: ProjectTusServer) {
    const now = Date.now()
    if (now - entry.lastSweepAt < SWEEP_INTERVAL_MS) return
    entry.lastSweepAt = now
    entry.server.cleanUpExpiredUploads().catch((error: Error) => {
      log.warn("[uploads] Expired partial cleanup failed:", errorMessage(error))
    })
  }

  return {
    async handle(req, projectId) {
      const project = getProject(projectId)
      if (!project) return Response.json({ error: "Project not found" }, { status: 404 })
      const entry = await serverFor(project)
      if (req.method === "POST") sweepExpired(entry)
      return entry.server.handleWeb(req)
    },
  }
}
