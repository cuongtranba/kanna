import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type PasteCommandType,
} from "lexical"
import { uploadFile } from "../../../lib/uploadFile.adapter"
import { runInlineUpload } from "./inlineUploadPending"
import { uploadFilesIntoEditor, type UploadFileFn } from "./inlineUploads"


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


export interface PasteImagePluginProps {
  projectId: string | null
  uploadOwnerId: string
  onUploadError?: (msg: string) => void
  uploadFileFn?: UploadFileFn
}


export function PasteImagePlugin({
  projectId,
  uploadOwnerId,
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
          runInlineUpload(uploadOwnerId, () => uploadFilesIntoEditor(files, editor, projectId, uploadFileFn, onUploadError))
        }

        return !hasText
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, projectId, uploadOwnerId, onUploadError, uploadFileFn])

  return null
}
