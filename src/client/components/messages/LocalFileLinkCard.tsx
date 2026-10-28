import { useMemo } from "react"
import type { ChatAttachment } from "../../../shared/types"
import { middleTruncate } from "../../lib/middleTruncate"
import { fileNameOfPath, toLocalFileUrl } from "../../lib/pathUtils"
import { ProbedFileCard } from "./ProbedFileCard"

interface Props {
  path: string
  linkText?: string
}

const UNPROBED_MIME_TYPE = "application/octet-stream"

export function LocalFileLinkCard({ path, linkText }: Props) {
  const contentUrl = useMemo(() => toLocalFileUrl(path), [path])
  const fileName = fileNameOfPath(path)
  const rawDisplayName = linkText || fileName

  const attachment: ChatAttachment = {
    id: `local-file-${contentUrl}`,
    kind: "file",
    displayName: middleTruncate(rawDisplayName, 28),
    absolutePath: path,
    relativePath: path,
    contentUrl,
    mimeType: UNPROBED_MIME_TYPE,
    size: 0,
  }

  return (
    <ProbedFileCard
      attachment={attachment}
      origin="local_file_link"
      testId="local-file-link"
      previewPolicy="when-previewable-and-reachable"
      inline
      downloadName={fileName}
      labelName={rawDisplayName}
      adoptProbeMetadata
      showProbeStatus
    />
  )
}
