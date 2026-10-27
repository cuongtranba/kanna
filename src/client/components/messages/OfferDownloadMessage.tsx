import type { HttpPort } from "../../ports/httpPort"
import type { ChatAttachment, HydratedOfferDownloadToolCall } from "../../../shared/types"
import { ProbedFileCard } from "./ProbedFileCard"

interface Props {
  message: HydratedOfferDownloadToolCall
  http?: HttpPort
}

export function OfferDownloadMessage({ message, http }: Props) {
  const result = message.result
  if (!result || !result.contentUrl) return null

  const attachment: ChatAttachment = {
    id: `offer-download-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl: result.contentUrl,
    mimeType: result.mimeType ?? "application/octet-stream",
    size: result.size,
  }

  return (
    <ProbedFileCard
      attachment={attachment}
      origin="offer_download"
      testId="offer-download-link"
      previewPolicy="when-previewable"
      http={http}
      downloadName={result.fileName || undefined}
    />
  )
}
