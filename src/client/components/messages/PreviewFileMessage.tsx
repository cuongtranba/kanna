import { useEffect, useState } from "react"
import type { ChatAttachment, HydratedPreviewFileToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, friendlyMimeLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"

interface Props {
  message: HydratedPreviewFileToolCall
}

type ProbeState = "idle" | "ready" | "missing"

export function PreviewFileMessage({ message }: Props) {
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
    id: `preview-file-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl,
    mimeType: result.mimeType,
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
      <div className="flex" data-testid="preview-file-card">
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </div>
    )
  }

  const ariaLabel = `Preview ${attachment.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`
  return (
    <>
      <div className="flex" data-testid="preview-file-card">
        <AttachmentFileCard
          attachment={attachment}
          onClick={() => setPreviewOpen(true)}
          meta={meta}
          ariaLabel={ariaLabel}
        />
      </div>
      <FilePreviewSheet
        source={previewOpen ? toPreviewSourceFromAttachment(attachment, "preview_file") : null}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
