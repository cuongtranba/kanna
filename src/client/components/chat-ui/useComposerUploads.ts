import { startTransition, useCallback, useEffect, useRef } from "react"
import type { ChatAttachment, UploadedAttachment } from "../../../shared/types"
import { errorMessage } from "../../../shared/errors"
import { deleteUploadedFile } from "../../api/files"
import { MAX_CONCURRENT_UPLOADS, MAX_FILES_PER_DROP } from "../../lib/composerLimits"
import { runDetached } from "../../lib/runDetached"
import { UploadAbortedError, uploadFile } from "../../lib/uploadFile.adapter"
import type { CommandPort } from "../../ports/commandPort"
import { useChatInputStore } from "../../stores/chatInputStore"
import {
  ChatTabScopedStore,
  toDraftAttachment,
  toWireAttachment,
  type ComposerAttachment,
} from "../../stores/chatTabScopedStore"

export function willExceedAttachmentLimit(args: {
  currentAttachmentCount: number
  queuedAttachmentCount: number
  incomingAttachmentCount: number
  maxAttachments?: number
}): boolean {
  const maxAttachments = args.maxAttachments ?? MAX_FILES_PER_DROP
  return (
    args.currentAttachmentCount + args.queuedAttachmentCount + args.incomingAttachmentCount >
    maxAttachments
  )
}

export async function deleteUploadedAttachment(attachment: UploadedAttachment, commands: CommandPort | null): Promise<void> {
  if (!attachment.contentUrl || attachment.reused) return
  await deleteUploadedFile(attachment.contentUrl, commands)
}

function releasePreview(attachment: ComposerAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
}

function hydrateDrafts(drafts: UploadedAttachment[]): ComposerAttachment[] {
  return drafts.map((draft) => ({ ...draft, status: "uploaded" as const }))
}

function uploadingPlaceholder(
  file: File,
  id: string,
  previewUrl: string | undefined,
  cancelUpload: () => void,
): ComposerAttachment {
  return {
    id,
    kind: file.type.startsWith("image/") ? "image" : "file",
    displayName: file.name,
    absolutePath: "",
    relativePath: "",
    contentUrl: "",
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    status: "uploading",
    previewUrl,
    uploadProgress: 0,
    cancelUpload,
  }
}

export interface ComposerSubmission {
  attachments: ChatAttachment[]
  commit: () => void
  rollback: () => void
}

export interface ComposerUploads {
  attachments: ComposerAttachment[]
  hasUploadedAttachments: boolean
  isUploading: boolean
  uploadError: string | null
  setUploadError: (message: string | null) => void
  selectedAttachment: ComposerAttachment | null
  selectAttachment: (id: string | null) => void
  enqueue: (files: File[]) => void
  remove: (attachment: ComposerAttachment) => void
  beginSubmit: () => ComposerSubmission
}

export function useComposerUploads({
  projectId,
  chatId,
  commands,
}: {
  projectId: string | null
  chatId: string | null
  commands: CommandPort | null
}): ComposerUploads {
  const storeApi = ChatTabScopedStore.useScopedStoreApi()
  const attachments = ChatTabScopedStore.useScopedStore((state) => state.attachments)
  const setAttachments = ChatTabScopedStore.useScopedStore((state) => state.setAttachments)
  const selectedAttachmentId = ChatTabScopedStore.useScopedStore((state) => state.selectedAttachmentId)
  const selectAttachment = ChatTabScopedStore.useScopedStore((state) => state.setSelectedAttachmentId)
  const uploadError = ChatTabScopedStore.useScopedStore((state) => state.uploadError)
  const setUploadError = ChatTabScopedStore.useScopedStore((state) => state.setUploadError)
  const getAttachmentDrafts = useChatInputStore((state) => state.getAttachmentDrafts)
  const setAttachmentDrafts = useChatInputStore((state) => state.setAttachmentDrafts)
  const clearAttachmentDrafts = useChatInputStore((state) => state.clearAttachmentDrafts)

  const queueRef = useRef<File[]>([])
  const activeRef = useRef(0)
  const generationRef = useRef(0)
  const removedIdsRef = useRef<Set<string>>(new Set())
  const previousProjectIdRef = useRef<string | null>(projectId)
  const pumpRef = useRef<(() => void) | undefined>(undefined)

  const abandonInFlight = useCallback(() => {
    generationRef.current += 1
    queueRef.current = []
    activeRef.current = 0
    removedIdsRef.current.clear()
  }, [])

  const clear = useCallback(
    (options?: { releasePreviews?: boolean }) => {
      abandonInFlight()
      setAttachments((current) => {
        if (options?.releasePreviews ?? true) current.forEach(releasePreview)
        return []
      })
      selectAttachment(null)
      setUploadError(null)
    },
    [abandonInFlight, selectAttachment, setAttachments, setUploadError],
  )

  const pump = useCallback(() => {
    if (!projectId) return

    while (activeRef.current < MAX_CONCURRENT_UPLOADS && queueRef.current.length > 0) {
      const file = queueRef.current.shift()
      if (!file) break

      activeRef.current += 1
      const tempId = crypto.randomUUID()
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      const generation = generationRef.current
      const isCurrent = () => generation === generationRef.current
      const releaseOwnPreview = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
      }

      const handle = uploadFile({
        projectId,
        file,
        onProgress: ({ loaded, total }) => {
          if (!isCurrent()) return
          const progress = total > 0 ? loaded / total : 0
          setAttachments((current) =>
            current.map((a) => (a.id === tempId ? { ...a, uploadProgress: progress } : a)),
          )
        },
      })

      setAttachments((current) => [...current, uploadingPlaceholder(file, tempId, previewUrl, handle.abort)])

      runDetached("attachment upload", (async () => {
        try {
          const { attachments: uploaded } = await handle.promise
          const result = uploaded[0]
          if (!result) throw new Error("Upload failed")

          if (!isCurrent()) {
            runDetached("abandoned upload cleanup", deleteUploadedAttachment(result, commands))
            releaseOwnPreview()
            return
          }

          if (removedIdsRef.current.has(tempId)) {
            removedIdsRef.current.delete(tempId)
            releaseOwnPreview()
            runDetached("abandoned upload cleanup", deleteUploadedAttachment(result, commands))
            return
          }

          setAttachments((current) =>
            current.map((a) =>
              a.id !== tempId
                ? a
                : {
                    ...a,
                    ...result,
                    previewUrl: a.previewUrl,
                    status: "uploaded" as const,
                    uploadProgress: 1,
                    cancelUpload: undefined,
                  },
            ),
          )
          setUploadError(null)
        } catch (error) {
          if (!isCurrent()) {
            releaseOwnPreview()
            return
          }
          if (error instanceof UploadAbortedError) {
            setAttachments((current) => current.filter((a) => a.id !== tempId))
            removedIdsRef.current.delete(tempId)
            releaseOwnPreview()
            return
          }
          setAttachments((current) =>
            current.map((a) =>
              a.id === tempId ? { ...a, status: "failed" as const, cancelUpload: undefined } : a,
            ),
          )
          setUploadError(errorMessage(error))
        } finally {
          activeRef.current = Math.max(0, activeRef.current - 1)
          pumpRef.current?.()
        }
      })())
    }
  }, [commands, projectId, setAttachments, setUploadError])

  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  const enqueue = useCallback(
    (files: File[]) => {
      if (!projectId) {
        setUploadError("Open a project before uploading files.")
        return
      }

      if (
        willExceedAttachmentLimit({
          currentAttachmentCount: storeApi.getState().attachments.length,
          queuedAttachmentCount: queueRef.current.length,
          incomingAttachmentCount: files.length,
        })
      ) {
        setUploadError(`You can upload up to ${MAX_FILES_PER_DROP} files at a time.`)
        return
      }

      queueRef.current.push(...files)
      setUploadError(null)
      pump()
    },
    [projectId, pump, setUploadError, storeApi],
  )

  const remove = useCallback(
    (attachment: ComposerAttachment) => {
      if (attachment.status === "uploading") {
        attachment.cancelUpload?.()
      }
      removedIdsRef.current.add(attachment.id)
      setAttachments((current) => {
        const removed = current.find((item) => item.id === attachment.id)
        if (removed) releasePreview(removed)
        return current.filter((item) => item.id !== attachment.id)
      })
      if (storeApi.getState().selectedAttachmentId === attachment.id) {
        selectAttachment(null)
      }
      if (attachment.status === "uploaded") {
        removedIdsRef.current.delete(attachment.id)
        runDetached("removed upload cleanup", deleteUploadedAttachment(attachment, commands))
      }
    },
    [commands, selectAttachment, setAttachments, storeApi],
  )

  const beginSubmit = useCallback((): ComposerSubmission => {
    const previous = storeApi.getState()
    const previousAttachments = previous.attachments
    const previousSelectedId = previous.selectedAttachmentId
    const previousError = previous.uploadError
    const attachmentsToSend = previousAttachments
      .filter((attachment) => attachment.status === "uploaded")
      .map(toWireAttachment)

    clear({ releasePreviews: false })
    if (chatId) clearAttachmentDrafts(chatId)

    return {
      attachments: attachmentsToSend,
      commit: () => previousAttachments.forEach(releasePreview),
      rollback: () => {
        setAttachments(previousAttachments)
        selectAttachment(previousSelectedId)
        setUploadError(previousError)
      },
    }
  }, [chatId, clear, clearAttachmentDrafts, selectAttachment, setAttachments, setUploadError, storeApi])

  useEffect(() => {
    abandonInFlight()
    selectAttachment(null)
    setUploadError(null)
    startTransition(() => {
      setAttachments((current) => {
        current.forEach(releasePreview)
        return hydrateDrafts(chatId ? getAttachmentDrafts(chatId) : [])
      })
    })
  }, [abandonInFlight, chatId, getAttachmentDrafts, selectAttachment, setAttachments, setUploadError])

  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current
    previousProjectIdRef.current = projectId

    if (previousProjectId === null || projectId === previousProjectId) return

    clear()
    if (chatId) clearAttachmentDrafts(chatId)
  }, [projectId, chatId, clear, clearAttachmentDrafts])

  useEffect(() => {
    if (!chatId) return

    const persisted = attachments
      .filter((attachment) => attachment.status === "uploaded")
      .map(toDraftAttachment)

    if (persisted.length === 0) {
      clearAttachmentDrafts(chatId)
      return
    }

    setAttachmentDrafts(chatId, persisted)
  }, [attachments, chatId, clearAttachmentDrafts, setAttachmentDrafts])

  useEffect(
    () => () => {
      storeApi.getState().attachments.forEach(releasePreview)
    },
    [storeApi],
  )

  return {
    attachments,
    hasUploadedAttachments: attachments.some((attachment) => attachment.status === "uploaded"),
    isUploading: attachments.some((attachment) => attachment.status === "uploading"),
    uploadError,
    setUploadError,
    selectedAttachment: attachments.find((attachment) => attachment.id === selectedAttachmentId) ?? null,
    selectAttachment,
    enqueue,
    remove,
    beginSubmit,
  }
}
