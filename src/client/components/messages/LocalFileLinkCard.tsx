import { useEffect, useMemo, useState } from "react"
import type { ChatAttachment } from "../../../shared/types"
import { middleTruncate } from "../../lib/middleTruncate"
import { toLocalFileUrl } from "../../lib/pathUtils"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"
import { classifyAttachmentIcon, classifyAttachmentPreview, friendlyMimeLabel } from "./attachmentPreview"

type ProbeState =
  | { kind: "loading" }
  | { kind: "ready"; mimeType: string; size: number }
  | { kind: "missing" }
  | { kind: "error" }

interface Props {
  path: string
  linkText?: string
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/")
  return idx >= 0 ? p.slice(idx + 1) : p
}

export function LocalFileLinkCard({ path, linkText }: Props) {
  const contentUrl = useMemo(() => toLocalFileUrl(path), [path])
  const [probe, setProbe] = useState<ProbeState>({ kind: "loading" })
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(contentUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        if (!response.ok) {
          setProbe({ kind: response.status === 404 ? "missing" : "error" })
          return
        }
        const mimeType = response.headers.get("Content-Type")?.split(";")[0]?.trim() || "application/octet-stream"
        const size = Number.parseInt(response.headers.get("Content-Length") ?? "0", 10) || 0
        setProbe({ kind: "ready", mimeType, size })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setProbe({ kind: "error" })
      })
    return () => controller.abort()
  }, [contentUrl])

  const fileName = basename(path)
  const rawDisplayName = linkText || fileName
  const displayName = middleTruncate(rawDisplayName, 28)

  const mimeType = probe.kind === "ready" ? probe.mimeType : "application/octet-stream"
  const size = probe.kind === "ready" ? probe.size : 0

  const attachment: ChatAttachment = {
    id: `local-file-${contentUrl}`,
    kind: "file",
    displayName,
    absolutePath: path,
    relativePath: path,
    contentUrl,
    mimeType,
    size,
  }

  if (probe.kind === "missing") {
    return (
      <span className="inline-flex align-bottom" data-testid="local-file-link">
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </span>
    )
  }

  const iconKind = classifyAttachmentIcon(attachment)
  const friendlyType = friendlyMimeLabel(iconKind, mimeType)
  const sizeLabel = size > 0 ? formatAttachmentSize(size) : null
  const isLoading = probe.kind === "loading"
  const isError = probe.kind === "error"

  const meta = isLoading ? (
    <span className="text-muted-foreground">Fetching…</span>
  ) : isError ? (
    <span className="text-muted-foreground">Unable to load</span>
  ) : (
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

  const previewTarget = probe.kind === "ready" ? classifyAttachmentPreview(attachment) : null
  const canPreviewInModal = previewTarget !== null && !previewTarget.openInNewTab
  const ariaLabelParts = [
    canPreviewInModal ? "Preview" : "Download",
    rawDisplayName,
    friendlyType,
    sizeLabel,
  ].filter(Boolean) as string[]

  if (canPreviewInModal) {
    return (
      <>
        <span className="inline-flex align-bottom" data-testid="local-file-link">
          <AttachmentFileCard
            attachment={attachment}
            onClick={() => setPreviewOpen(true)}
            meta={meta}
            ariaLabel={ariaLabelParts.join(", ")}
          />
        </span>
        <FilePreviewSheet
          source={previewOpen ? toPreviewSourceFromAttachment(attachment, "local_file_link") : null}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      </>
    )
  }

  return (
    <span className="inline-flex align-bottom" data-testid="local-file-link">
      <AttachmentFileCard
        attachment={attachment}
        href={contentUrl}
        download={fileName}
        meta={meta}
        ariaLabel={ariaLabelParts.join(", ")}
      />
    </span>
  )
}
