import type { AttachmentKind, UploadedAttachment } from "../../shared/types"
import type { DetailedError, PreviousUpload, UploadOptions } from "tus-js-client"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import { runDetached } from "./runDetached"

const ATTACHMENT_KINDS = new Set<string>(["image", "file", "mention"] satisfies AttachmentKind[])

function isAttachmentKind(value: JsonValue): value is AttachmentKind {
  return typeof value === "string" && ATTACHMENT_KINDS.has(value)
}

function stringOr(value: JsonValue, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function parseAttachment(value: JsonValue): UploadedAttachment | null {
  if (!isJsonObject(value)) return null
  const id = value.id
  if (typeof id !== "string") return null
  return {
    id,
    kind: isAttachmentKind(value.kind) ? value.kind : "file",
    displayName: stringOr(value.displayName, ""),
    absolutePath: stringOr(value.absolutePath, ""),
    relativePath: stringOr(value.relativePath, ""),
    contentUrl: stringOr(value.contentUrl, ""),
    mimeType: stringOr(value.mimeType, ""),
    size: typeof value.size === "number" ? value.size : 0,
    ...(value.reused === true ? { reused: true } : {}),
  }
}

function parseAttachments(value: JsonValue): UploadedAttachment[] | null {
  if (!isJsonArray(value)) return null
  const attachments: UploadedAttachment[] = []
  for (const entry of value) {
    const attachment = parseAttachment(entry)
    if (attachment) attachments.push(attachment)
  }
  return attachments
}

export class UploadAbortedError extends Error {
  constructor() {
    super("Upload aborted")
    this.name = "UploadAbortedError"
  }
}

export interface UploadProgressEvent {
  loaded: number
  total: number
}

export interface UploadFileResponse {
  attachments: UploadedAttachment[]
}

export interface UploadHandle {
  promise: Promise<UploadFileResponse>
  abort: () => void
}

export interface TusUploadLike {
  start(): void
  abort(shouldTerminate?: boolean): Promise<void>
  findPreviousUploads(): Promise<PreviousUpload[]>
  resumeFromPreviousUpload(previousUpload: PreviousUpload): void
}

export interface TusModule {
  Upload: new (file: File, options: UploadOptions) => TusUploadLike
}

export type LoadTus = () => Promise<TusModule>

export interface UploadFileArgs {
  projectId: string
  file: File
  onProgress: (event: UploadProgressEvent) => void
  loadTus?: LoadTus
}

const PROGRESS_THROTTLE_MS = 80
const CHUNK_SIZE_BYTES = 8 * 1024 * 1024
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10000]
const GENERIC_ERROR_MESSAGE = "Upload failed"

const loadTusClient: LoadTus = () => import("tus-js-client")

function serverErrorMessage(error: Error | DetailedError): string {
  const body = "originalResponse" in error ? error.originalResponse?.getBody() : undefined
  const payload: JsonValue = body ? safeJsonParse(body) : null
  const message = isJsonObject(payload) ? payload.error : null
  return typeof message === "string" && message ? message : GENERIC_ERROR_MESSAGE
}

export function uploadFile(args: UploadFileArgs): UploadHandle {
  const loadTus = args.loadTus ?? loadTusClient
  let aborted = false
  let activeUpload: TusUploadLike | null = null
  let rejectUpload: (error: Error) => void = () => {}
  let lastEmittedAt = 0
  let lastEmittedPercent = -1

  const promise = new Promise<UploadFileResponse>((resolve, reject) => {
    rejectUpload = reject

    function emitProgress(loaded: number, total: number, force = false) {
      const safeTotal = total > 0 ? total : args.file.size
      const percent = safeTotal > 0 ? Math.floor((loaded / safeTotal) * 100) : 0
      const now = Date.now()
      const enoughTimePassed = now - lastEmittedAt >= PROGRESS_THROTTLE_MS
      const percentChanged = percent !== lastEmittedPercent
      if (!force && !enoughTimePassed && !percentChanged) return
      lastEmittedAt = now
      lastEmittedPercent = percent
      args.onProgress({ loaded, total: safeTotal })
    }

    async function run() {
      const { Upload } = await loadTus()
      if (aborted) return

      const upload = new Upload(args.file, {
        endpoint: `/api/projects/${encodeURIComponent(args.projectId)}/uploads/tus`,
        chunkSize: CHUNK_SIZE_BYTES,
        retryDelays: RETRY_DELAYS_MS,
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          filename: args.file.name,
          ...(args.file.type ? { filetype: args.file.type } : {}),
        },
        onProgress: (loaded, total) => emitProgress(loaded, total),
        onSuccess: ({ lastResponse }) => {
          if (aborted) return
          emitProgress(args.file.size, args.file.size, true)
          const body = lastResponse.getBody()
          const payload: JsonValue = body ? safeJsonParse(body) : null
          const attachments = isJsonObject(payload) ? parseAttachments(payload.attachments) : null
          if (!attachments) {
            reject(new Error("Upload failed: malformed response"))
            return
          }
          resolve({ attachments })
        },
        onError: (error) => {
          if (aborted) return
          reject(new Error(serverErrorMessage(error)))
        },
      })
      activeUpload = upload

      const [previous] = await upload.findPreviousUploads()
      if (aborted) return
      if (previous) upload.resumeFromPreviousUpload(previous)
      upload.start()
    }

    run().then(undefined, (error: Error) => {
      if (aborted) return
      reject(error instanceof Error ? error : new Error(GENERIC_ERROR_MESSAGE))
    })
  })

  return {
    promise,
    abort: () => {
      if (aborted) return
      aborted = true
      rejectUpload(new UploadAbortedError())
      if (activeUpload) runDetached("terminating aborted upload", activeUpload.abort(true))
    },
  }
}
