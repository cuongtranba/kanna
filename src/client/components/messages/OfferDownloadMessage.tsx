import { useEffect, useState } from "react"
import type { ChatAttachment, HydratedOfferDownloadToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, friendlyMimeLabel } from "./attachmentPreview"

interface Props {
  message: HydratedOfferDownloadToolCall
}

type ProbeState = "idle" | "ready" | "missing"

export function OfferDownloadMessage({ message }: Props) {
  const result = message.result
  const contentUrl = result?.contentUrl
  const [state, setState] = useState<ProbeState>("idle")

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    fetch(contentUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        setState(response.ok ? "ready" : "missing")
      })
      .catch(() => {
        // Network errors leave the chip optimistic; only 404-class responses mark missing.
      })
    return () => controller.abort()
  }, [contentUrl])

  if (!result || !contentUrl) {
    return null
  }

  const attachment: ChatAttachment = {
    id: `offer-download-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl,
    mimeType: result.mimeType ?? "application/octet-stream",
    size: result.size,
  }

  const iconKind = classifyAttachmentIcon(attachment)
  const friendlyType = friendlyMimeLabel(iconKind, result.mimeType)
  const sizeLabel = result.size > 0 ? formatAttachmentSize(result.size) : null
  const meta = (
    <>
      {friendlyType}
      {sizeLabel ? (
        <>
          {" · "}
          <span className="tabular-nums">{sizeLabel}</span>
        </>
      ) : null}
    </>
  )

  const ariaLabelParts = [
    "Download",
    attachment.displayName,
    friendlyType,
    sizeLabel,
  ].filter(Boolean) as string[]

  if (state === "missing") {
    return (
      <div className="flex" data-testid="offer-download-link">
        <AttachmentFileCard
          attachment={attachment}
          disabledReason="File no longer available"
        />
      </div>
    )
  }

  return (
    <div className="flex" data-testid="offer-download-link">
      <AttachmentFileCard
        attachment={attachment}
        href={contentUrl}
        download={result.fileName || undefined}
        meta={meta}
        ariaLabel={ariaLabelParts.join(", ")}
      />
    </div>
  )
}
