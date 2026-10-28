import type { ChatAttachment, HydratedPreviewFileToolCall } from "../../../shared/types"
import { ProbedFileCard } from "./ProbedFileCard"

interface Props {
  message: HydratedPreviewFileToolCall
}

export function PreviewFileMessage({ message }: Props) {
  const result = message.result
  if (!result || !result.contentUrl) return null

  const attachment: ChatAttachment = {
    id: `preview-file-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl: result.contentUrl,
    mimeType: result.mimeType,
    size: result.size,
  }

  return (
    <ProbedFileCard
      attachment={attachment}
      origin="preview_file"
      testId="preview-file-card"
      previewPolicy="always"
    />
  )
}
