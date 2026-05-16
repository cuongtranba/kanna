import { useEffect, useState } from "react"
import type { ChatAttachment, HydratedOfferDownloadToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, classifyAttachmentPreview, friendlyMimeLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"

interface Props {
  message: HydratedOfferDownloadToolCall
}

type ProbeState = "idle" | "ready" | "missing"

export function OfferDownloadMessage({ message }: Props) {
  const result = message.result
  const contentUrl = result?.contentUrl
  const [state, setState] = useState<ProbeState>("idle")
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    fetch(contentUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        setState(response.ok ? "ready" : "missing")
      })
      .catch(() => {})
    return () => controller.abort()
  }, [contentUrl])

  if (!result || !contentUrl) return null

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
      {sizeLabel ? <> · <span className="tabular-nums">{sizeLabel}</span></> : null}
    </>
  )

  if (state === "missing") {
    return (
      <div className="flex" data-testid="offer-download-link">
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </div>
    )
  }

  const previewTarget = classifyAttachmentPreview(attachment)
  const canPreview = !previewTarget.openInNewTab

  if (canPreview) {
    const ariaLabel = `Preview ${attachment.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`
    return (
      <>
        <div className="flex" data-testid="offer-download-link">
          <AttachmentFileCard
            attachment={attachment}
            onClick={() => setPreviewOpen(true)}
            meta={meta}
            ariaLabel={ariaLabel}
          />
        </div>
        <FilePreviewSheet
          source={previewOpen ? toPreviewSourceFromAttachment(attachment, "offer_download") : null}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      </>
    )
  }

  const ariaLabelParts = ["Download", attachment.displayName, friendlyType, sizeLabel].filter(Boolean) as string[]
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
