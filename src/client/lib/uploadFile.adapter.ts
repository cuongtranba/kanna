import type { AttachmentKind, ChatAttachment } from "../../shared/types"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"

const ATTACHMENT_KINDS = new Set<string>(["image", "file", "mention"] satisfies AttachmentKind[])

function isAttachmentKind(value: JsonValue): value is AttachmentKind {
  return typeof value === "string" && ATTACHMENT_KINDS.has(value)
}

function stringOr(value: JsonValue, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

/**
 * Decode one attachment out of the upload response. The wire is JSON, so each
 * field is read through a guard; an entry with no `id` is dropped rather than
 * forwarded, because nothing downstream can address it.
 */
function parseAttachment(value: JsonValue): ChatAttachment | null {
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
  }
}

/** `null` means "this response was not an attachment list" — a hard failure. */
function parseAttachments(value: JsonValue): ChatAttachment[] | null {
  if (!isJsonArray(value)) return null
  const attachments: ChatAttachment[] = []
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
  attachments: ChatAttachment[]
}

export interface UploadHandle {
  promise: Promise<UploadFileResponse>
  abort: () => void
}

export interface UploadFileArgs {
  projectId: string
  file: File
  onProgress: (event: UploadProgressEvent) => void
  XHR?: typeof XMLHttpRequest
}

const PROGRESS_THROTTLE_MS = 80

export function uploadFile(args: UploadFileArgs): UploadHandle {
  const XHRImpl = args.XHR ?? XMLHttpRequest
  const xhr = new XHRImpl()
  let aborted = false
  let lastEmittedAt = 0
  let lastEmittedPercent = -1

  const promise = new Promise<UploadFileResponse>((resolve, reject) => {
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

    xhr.upload.addEventListener("progress", (event) => {
      emitProgress(event.loaded, event.lengthComputable ? event.total : args.file.size)
    })

    xhr.upload.addEventListener("load", () => {
      emitProgress(args.file.size, args.file.size, true)
    })

    xhr.addEventListener("load", () => {
      if (aborted) return
      const payload: JsonValue = xhr.responseText ? safeJsonParse(xhr.responseText) : null

      const body = isJsonObject(payload) ? payload : null

      if (xhr.status >= 200 && xhr.status < 300) {
        const attachments = body ? parseAttachments(body.attachments) : null
        if (!attachments) {
          reject(new Error("Upload failed: malformed response"))
          return
        }
        resolve({ attachments })
        return
      }

      const errorMessage = body?.error
      reject(new Error(typeof errorMessage === "string" ? errorMessage : "Upload failed"))
    })

    xhr.addEventListener("error", () => {
      if (aborted) return
      reject(new Error("Upload failed"))
    })

    xhr.addEventListener("abort", () => {
      reject(new UploadAbortedError())
    })

    const formData = new FormData()
    formData.append("files", args.file)

    xhr.open("POST", `/api/projects/${encodeURIComponent(args.projectId)}/uploads`)
    xhr.send(formData)
  })

  return {
    promise,
    abort: () => {
      if (aborted) return
      aborted = true
      try {
        xhr.abort()
      } catch {
        // no-op: abort can throw if request already settled
      }
    },
  }
}
