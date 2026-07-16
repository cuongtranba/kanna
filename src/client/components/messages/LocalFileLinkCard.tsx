import { useEffect, useMemo } from "react"
import { probeFileUrl } from "../../api/files"
import type { ChatAttachment } from "../../../shared/types"
import { middleTruncate } from "../../lib/middleTruncate"
import { toLocalFileUrl } from "../../lib/pathUtils"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"
import { classifyAttachmentIcon, classifyAttachmentPreview, friendlyMimeLabel } from "./attachmentPreview"
import { LocalFileLinkCardStore } from "./LocalFileLinkCard.store"

interface Props {
  path: string
  linkText?: string
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/")
  return idx >= 0 ? p.slice(idx + 1) : p
}

function LocalFileLinkCardInner({ path, linkText }: Props) {
  const contentUrl = useMemo(() => toLocalFileUrl(path), [path])
  const probe = LocalFileLinkCardStore.useScopedStore((s) => s.probe)
  const previewOpen = LocalFileLinkCardStore.useScopedStore((s) => s.previewOpen)
  const setProbe = LocalFileLinkCardStore.useScopedStore((s) => s.setProbe)
  const setPreviewOpen = LocalFileLinkCardStore.useScopedStore((s) => s.setPreviewOpen)

  useEffect(() => {
    const controller = new AbortController()
    probeFileUrl(contentUrl, { signal: controller.signal }).then((probe) => {
      if (controller.signal.aborted) return
      setProbe(probe)
    })
    return () => controller.abort()
  }, [contentUrl, setProbe])

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

  let meta: React.ReactNode
  if (isLoading) {
    meta = <span className="text-muted-foreground">Fetching…</span>
  } else if (isError) {
    meta = <span className="text-muted-foreground">Unable to load</span>
  } else {
    meta = (
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
  }

  const previewTarget = probe.kind === "ready" ? classifyAttachmentPreview(attachment) : null
  const canPreviewInModal = previewTarget !== null && !previewTarget.openInNewTab
  const ariaLabelParts = [
    canPreviewInModal ? "Preview" : "Download",
    rawDisplayName,
    friendlyType,
    sizeLabel,
  ].filter((s): s is string => Boolean(s))

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

export function LocalFileLinkCard({ path, linkText }: Props) {
  return (
    <LocalFileLinkCardStore.Provider init={undefined}>
      <LocalFileLinkCardInner path={path} linkText={linkText} />
    </LocalFileLinkCardStore.Provider>
  )
}
