import { useEffect } from "react"
import { probeFileUrl } from "../../api/files"
import { runDetached } from "../../lib/runDetached"
import type { HttpPort } from "../../ports/httpPort"
import type { ChatAttachment } from "../../../shared/types"
import { withScopedStore } from "../../lib/createScopedStore"
import { AttachmentFileCard, FileMetaLabel } from "./AttachmentCard"
import { classifyAttachmentPreview, describeFile, fileAriaLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment, type PreviewOrigin } from "./file-preview/types"
import { ProbedFileCardStore } from "./ProbedFileCard.store"

export type PreviewPolicy = "always" | "when-previewable" | "when-previewable-and-reachable"

export interface ProbedFileCardProps {
  attachment: ChatAttachment
  origin: PreviewOrigin
  testId: string
  previewPolicy: PreviewPolicy
  inline?: boolean
  http?: HttpPort
  downloadName?: string
  labelName?: string
  adoptProbeMetadata?: boolean
  showProbeStatus?: boolean
}

function ProbedFileCardInner({
  attachment,
  origin,
  testId,
  previewPolicy,
  inline = false,
  http,
  downloadName,
  labelName,
  adoptProbeMetadata = false,
  showProbeStatus = false,
}: ProbedFileCardProps) {
  const contentUrl = attachment.contentUrl
  const probe = ProbedFileCardStore.useScopedStore((s) => s.probe)
  const previewOpen = ProbedFileCardStore.useScopedStore((s) => s.previewOpen)
  const setProbe = ProbedFileCardStore.useScopedStore((s) => s.setProbe)
  const setPreviewOpen = ProbedFileCardStore.useScopedStore((s) => s.setPreviewOpen)

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    runDetached("probe file card", probeFileUrl(contentUrl, { signal: controller.signal, http }).then((result) => {
      if (controller.signal.aborted) return
      setProbe(result)
    }))
    return () => controller.abort()
  }, [contentUrl, http, setProbe])

  const Wrapper = inline ? "span" : "div"
  const wrapperClassName = inline ? "inline-flex align-bottom" : "flex"

  if (probe.kind === "missing") {
    return (
      <Wrapper className={wrapperClassName} data-testid={testId}>
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </Wrapper>
    )
  }

  const effective = adoptProbeMetadata && probe.kind === "ready"
    ? { ...attachment, mimeType: probe.mimeType, size: probe.size }
    : attachment
  const description = describeFile(effective)
  const reachable = probe.kind === "ready"
  const opensSheet = previewPolicy === "always"
    || (!classifyAttachmentPreview(effective).openInNewTab && (previewPolicy === "when-previewable" || reachable))

  let meta = <FileMetaLabel description={description} />
  if (showProbeStatus && probe.kind === "loading") meta = <span className="text-muted-foreground">Fetching…</span>
  if (showProbeStatus && probe.kind === "error") meta = <span className="text-muted-foreground">Unable to load</span>

  const ariaLabel = fileAriaLabel(opensSheet ? "Preview" : "Download", labelName ?? effective.displayName, description)

  return (
    <>
      <Wrapper className={wrapperClassName} data-testid={testId}>
        {opensSheet ? (
          <AttachmentFileCard
            attachment={effective}
            onClick={() => setPreviewOpen(true)}
            meta={meta}
            ariaLabel={ariaLabel}
          />
        ) : (
          <AttachmentFileCard
            attachment={effective}
            href={contentUrl}
            download={downloadName}
            meta={meta}
            ariaLabel={ariaLabel}
          />
        )}
      </Wrapper>
      {opensSheet ? (
        <FilePreviewSheet
          source={previewOpen ? toPreviewSourceFromAttachment(effective, origin) : null}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      ) : null}
    </>
  )
}

export const ProbedFileCard = withScopedStore(ProbedFileCardStore, ProbedFileCardInner)
