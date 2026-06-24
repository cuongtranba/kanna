import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  $insertNodes,
  type PasteCommandType,
  type LexicalEditor,
} from "lexical"
import { uploadFile } from "../../../lib/uploadFile"
import { $createAttachmentNode } from "../nodes"
import type { ChatAttachment } from "../../../../shared/types"

// ─── Constants (mirrors ChatInput) ──────────────────────────────────────────

export const MAX_FILES_PER_PASTE = 50
export const MAX_CONCURRENT_UPLOADS = 3

// ─── Clipboard helpers (ported from ChatInput.tsx) ────────────────────────────

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

// ─── Upload helpers ────────────────────────────────────────────────────────────

export type UploadFileFn = typeof uploadFile

/**
 * Uploads a batch of Files and inserts an AttachmentNode for each one.
 * Respects MAX_CONCURRENT_UPLOADS concurrency. Exported for testing.
 */
export async function uploadAndInsertFiles(
  files: File[],
  editor: LexicalEditor,
  chatId: string,
  uploadFileFn: UploadFileFn,
  onUploadError?: (msg: string) => void,
): Promise<void> {
  if (files.length === 0 || files.length > MAX_FILES_PER_PASTE) return

  // Process with concurrency limit
  let index = 0

  async function processNext(): Promise<void> {
    if (index >= files.length) return
    const file = files[index++]

    try {
      const handle = uploadFileFn({
        projectId: chatId,
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

  // Spin up up to MAX_CONCURRENT_UPLOADS concurrent chains
  const chains: Promise<void>[] = []
  for (let i = 0; i < Math.min(MAX_CONCURRENT_UPLOADS, files.length); i++) {
    chains.push(processNext())
  }
  await Promise.all(chains)
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PasteImagePluginProps {
  chatId: string | null
  onUploadError?: (msg: string) => void
  /** Injectable for testing. Defaults to the real uploadFile. */
  uploadFileFn?: UploadFileFn
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function PasteImagePlugin({
  chatId,
  onUploadError,
  uploadFileFn = uploadFile,
}: PasteImagePluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand<PasteCommandType>(
      PASTE_COMMAND,
      (payload) => {
        // Only handle ClipboardEvents (keyboard paste / context-menu paste).
        // InputEvent and KeyboardEvent variants don't carry clipboard data.
        if (!(payload instanceof ClipboardEvent)) return false

        const clipboardData = payload.clipboardData
        const files = getClipboardImageFiles(clipboardData?.items ?? [], Date.now())
        if (files.length === 0) return false

        // If there is also text content, let Lexical handle the text paste
        // normally — only intercept file extraction, don't stop propagation.
        const hasText = hasClipboardTextPayload(clipboardData)

        if (chatId) {
          // Fire-and-forget: we don't block the editor on upload
          void uploadAndInsertFiles(files, editor, chatId, uploadFileFn, onUploadError)
        }

        // Return true (handled) only when there is NO text, so Lexical doesn't
        // also try to paste the clipboard text. When text IS present we return
        // false and let the default text paste proceed.
        return !hasText
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, chatId, onUploadError, uploadFileFn])

  return null
}
