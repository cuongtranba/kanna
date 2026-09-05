import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  $insertNodes,
  type PasteCommandType,
  type LexicalEditor,
} from "lexical"
import { uploadFile } from "../../../lib/uploadFile.adapter"
import { $createAttachmentNode } from "../nodes"
import type { ChatAttachment } from "../../../../shared/types"


export const MAX_FILES_PER_PASTE = 50
export const MAX_CONCURRENT_UPLOADS = 3


const CLIPBOARD_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

function getClipboardImageExtension(file: File): string {
  return CLIPBOARD_EXTENSION_BY_MIME_TYPE[file.type] ?? "bin"
}

function isGenericClipboardImageName(file: File): boolean {
  const normalized = file.name.trim().toLowerCase()
  if (!normalized) return true
  const expectedExtension = getClipboardImageExtension(file)
  return normalized === `image.${expectedExtension}` || normalized === "image.png"
}

export function normalizeClipboardImageFile(file: File, index: number, timestamp: number): File {
  if (file.name && !isGenericClipboardImageName(file)) return file

  const extension = getClipboardImageExtension(file)
  const suffix = index === 0 ? "" : `-${index}`
  const fileName = `clipboard-${timestamp}${suffix}.${extension}`
  Object.defineProperty(file, "name", {
    configurable: true,
    value: fileName,
  })
  return file
}

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">

export function getClipboardImageFiles(items: Iterable<ClipboardFileItem>, timestamp: number): File[] {
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (!file) continue
    files.push(normalizeClipboardImageFile(file, files.length, timestamp))
  }
  return files
}

export function trimTrailingPastedNewlines(text: string): string {
  return text.replace(/(?:\r\n|\r|\n)+$/, "")
}

export function hasClipboardTextPayload(clipboardData: DataTransfer | null | undefined): boolean {
  if (!clipboardData) return false
  return clipboardData.types.includes("text/plain") || clipboardData.types.includes("text/html")
}


export type UploadFileFn = typeof uploadFile

export async function uploadAndInsertFiles(
  files: File[],
  editor: LexicalEditor,
  projectId: string,
  uploadFileFn: UploadFileFn,
  onUploadError?: (msg: string) => void,
): Promise<void> {
  if (files.length === 0 || files.length > MAX_FILES_PER_PASTE) return

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
      onUploadError?.(err instanceof Error ? err.message : String(err))
    }

    await processNext()
  }

  const chains: Promise<void>[] = []
  for (let i = 0; i < Math.min(MAX_CONCURRENT_UPLOADS, files.length); i++) {
    chains.push(processNext())
  }
  await Promise.all(chains)
}


export interface PasteImagePluginProps {
  projectId: string | null
  onUploadError?: (msg: string) => void
  uploadFileFn?: UploadFileFn
}


export function PasteImagePlugin({
  projectId,
  onUploadError,
  uploadFileFn = uploadFile,
}: PasteImagePluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand<PasteCommandType>(
      PASTE_COMMAND,
      (payload) => {
        if (!(payload instanceof ClipboardEvent)) return false

        const clipboardData = payload.clipboardData
        const files = getClipboardImageFiles(clipboardData?.items ?? [], Date.now())
        if (files.length === 0) return false

        const hasText = hasClipboardTextPayload(clipboardData)

        if (projectId) {
          void uploadAndInsertFiles(files, editor, projectId, uploadFileFn, onUploadError)
        }

        return !hasText
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, projectId, onUploadError, uploadFileFn])

  return null
}
