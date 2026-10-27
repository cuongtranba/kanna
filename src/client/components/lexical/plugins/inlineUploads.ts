import { $insertNodes, type LexicalEditor } from "lexical"
import type { uploadFile } from "../../../lib/uploadFile.adapter"
import { $createAttachmentNode } from "../nodes"
import type { ChatAttachment } from "../../../../shared/types"
import { errorMessage } from "../../../../shared/errors"
import { MAX_CONCURRENT_UPLOADS, MAX_FILES_PER_DROP } from "../../../lib/composerLimits"

export const INLINE_UPLOAD_LIMITS = { maxFiles: MAX_FILES_PER_DROP, maxConcurrent: MAX_CONCURRENT_UPLOADS } as const

export type UploadFileFn = typeof uploadFile

export async function uploadFilesIntoEditor(
  files: File[],
  editor: LexicalEditor,
  projectId: string,
  uploadFileFn: UploadFileFn,
  onUploadError?: (msg: string) => void,
): Promise<void> {
  if (files.length === 0 || files.length > INLINE_UPLOAD_LIMITS.maxFiles) return

  let index = 0

  async function processNext(): Promise<void> {
    if (index >= files.length) return
    const file = files[index++]

    try {
      const handle = uploadFileFn({
        projectId,
        file,
        onProgress: () => {
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
      onUploadError?.(errorMessage(err))
    }

    await processNext()
  }

  const chains: Promise<void>[] = []
  for (let i = 0; i < Math.min(INLINE_UPLOAD_LIMITS.maxConcurrent, files.length); i++) {
    chains.push(processNext())
  }
  await Promise.all(chains)
}
