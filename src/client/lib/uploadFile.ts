import type { ChatAttachment } from "../../shared/types"

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
      let payload: unknown = null
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        payload = null
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        const attachments = (payload as { attachments?: ChatAttachment[] } | null)?.attachments
        if (!Array.isArray(attachments)) {
          reject(new Error("Upload failed: malformed response"))
          return
        }
        resolve({ attachments })
        return
      }

      const errorMessage = (payload as { error?: string } | null)?.error
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
