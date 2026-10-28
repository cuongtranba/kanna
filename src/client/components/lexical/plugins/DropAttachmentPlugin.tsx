import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  DRAGOVER_COMMAND,
} from "lexical"
import { uploadFile } from "../../../lib/uploadFile.adapter"
import { runInlineUpload } from "./inlineUploadPending"
import { uploadFilesIntoEditor, type UploadFileFn } from "./inlineUploads"


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
  const fileList = event.dataTransfer?.files
  if (!fileList) return []
  const files: File[] = []
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i]
    if (f) files.push(f)
  }
  return files
}


export interface DropAttachmentPluginProps {
  projectId: string | null
  uploadOwnerId: string
  onUploadError?: (msg: string) => void
  uploadFileFn?: UploadFileFn
}


export function DropAttachmentPlugin({
  projectId,
  uploadOwnerId,
  onUploadError,
  uploadFileFn = uploadFile,
}: DropAttachmentPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const unregisterDragover = editor.registerCommand<DragEvent>(
      DRAGOVER_COMMAND,
      (event) => {
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
          runInlineUpload(uploadOwnerId, () => uploadFilesIntoEditor(files, editor, projectId, uploadFileFn, onUploadError))
        }
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      unregisterDragover()
      unregisterDrop()
    }
  }, [editor, projectId, uploadOwnerId, onUploadError, uploadFileFn])

  return null
}
