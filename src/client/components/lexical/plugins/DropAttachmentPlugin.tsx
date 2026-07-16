import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
  $insertNodes,
  type LexicalEditor,
} from "lexical"
import { uploadFile } from "../../../lib/uploadFile.adapter"
import { $createAttachmentNode } from "../nodes"
import type { ChatAttachment } from "../../../../shared/types"

// ─── Constants (mirrors ChatInput) ───────────────────────────────────────────

export const MAX_FILES_PER_DROP = 50
export const MAX_CONCURRENT_DROP_UPLOADS = 3

// ─── Upload helpers ────────────────────────────────────────────────────────────

export type UploadFileFn = typeof uploadFile

/**
 * Uploads a batch of Files and inserts an AttachmentNode for each one.
 * Respects MAX_CONCURRENT_DROP_UPLOADS concurrency. Exported for testing.
 */
export async function uploadDroppedFiles(
  files: File[],
  editor: LexicalEditor,
  projectId: string,
  uploadFileFn: UploadFileFn,
  onUploadError?: (msg: string) => void,
): Promise<void> {
  if (files.length === 0 || files.length > MAX_FILES_PER_DROP) return

  let index = 0

  async function processNext(): Promise<void> {
    if (index >= files.length) return
    const file = files[index++]

    try {
      const handle = uploadFileFn({
        projectId,
        file,
        onProgress: () => {
          // progress not tracked in the lexical plugin (no per-file progress UI here)
        },
      })
      const { attachments } = await handle.promise
      const attachment: ChatAttachment | undefined = attachments[0]
      if (!attachment) {
        onUploadError?.("Upload failed: no attachment returned")
        return
      }
      editor.update(() => {
        $insertNodes([$createAttachmentNode(attachment)])
      })
    } catch (err) {
      if (err instanceof Error && err.name === "UploadAbortedError") return
      onUploadError?.(err instanceof Error ? err.message : String(err))
    }

    await processNext()
  }

  const chains: Promise<void>[] = []
  for (let i = 0; i < Math.min(MAX_CONCURRENT_DROP_UPLOADS, files.length); i++) {
    chains.push(processNext())
  }
  await Promise.all(chains)
}

/**
 * Extracts File objects from a DragEvent's dataTransfer.
 * Returns an empty array when the event carries no files.
 */
export function getDroppedFiles(event: DragEvent): File[] {
  const items = event.dataTransfer?.items
  if (items) {
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.kind === "file") {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    return files
  }
  // Fallback: use FileList directly
  const fileList = event.dataTransfer?.files
  if (!fileList) return []
  const files: File[] = []
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i]
    if (f) files.push(f)
  }
  return files
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DropAttachmentPluginProps {
  projectId: string | null
  onUploadError?: (msg: string) => void
  /** Injectable for testing. Defaults to the real uploadFile. */
  uploadFileFn?: UploadFileFn
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function DropAttachmentPlugin({
  projectId,
  onUploadError,
  uploadFileFn = uploadFile,
}: DropAttachmentPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterDragover = editor.registerCommand<DragEvent>(
      DRAGOVER_COMMAND,
      (event) => {
        // Signal that drops are accepted so the browser shows the copy cursor.
        const files = getDroppedFiles(event)
        if (files.length === 0) return false
        event.preventDefault()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const unregisterDrop = editor.registerCommand<DragEvent>(
      DROP_COMMAND,
      (event) => {
        const files = getDroppedFiles(event)
        if (files.length === 0) return false

        event.preventDefault()

        if (projectId) {
          void uploadDroppedFiles(files, editor, projectId, uploadFileFn, onUploadError)
        }
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      unregisterDragover()
      unregisterDrop()
    }
  }, [editor, projectId, onUploadError, uploadFileFn])

  return null
}
