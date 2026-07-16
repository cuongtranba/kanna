import { useEffect } from "react"
import { probeFileUrl } from "../../api/files"
import type { ChatAttachment, HydratedOfferDownloadToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, classifyAttachmentPreview, friendlyMimeLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"
import { OfferDownloadMessageStore } from "./OfferDownloadMessage.store"

interface Props {
  message: HydratedOfferDownloadToolCall
}

function OfferDownloadMessageInner({ message }: Props) {
  const result = message.result
  const contentUrl = result?.contentUrl
  const probeState = OfferDownloadMessageStore.useScopedStore((s) => s.probeState)
  const previewOpen = OfferDownloadMessageStore.useScopedStore((s) => s.previewOpen)
  const setProbeState = OfferDownloadMessageStore.useScopedStore((s) => s.setProbeState)
  const setPreviewOpen = OfferDownloadMessageStore.useScopedStore((s) => s.setPreviewOpen)

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    probeFileUrl(contentUrl, { signal: controller.signal }).then((probe) => {
      if (controller.signal.aborted) return
      // Only 404 means the file is gone; 401/5xx (mapped to "error") are
      // auth or proxy failures and must not disable the card, so they are
      // intentionally left unhandled (probeState stays at its current
      // value, matching the original code's swallowed-fetch-error behavior).
      if (probe.kind === "ready") setProbeState("ready")
      else if (probe.kind === "missing") setProbeState("missing")
    })
    return () => controller.abort()
  }, [contentUrl, setProbeState])

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

  if (probeState === "missing") {
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

  const ariaLabelParts = ["Download", attachment.displayName, friendlyType, sizeLabel].filter((s): s is string => Boolean(s))
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

export function OfferDownloadMessage({ message }: Props) {
  return (
    <OfferDownloadMessageStore.Provider init={undefined}>
      <OfferDownloadMessageInner message={message} />
    </OfferDownloadMessageStore.Provider>
  )
}
