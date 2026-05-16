import { createElement, useCallback, useMemo } from "react"
import { Share2, Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog"
import { Button } from "../../ui/button"
import { classifyAttachmentPreview, classifyAttachmentIcon, friendlyMimeLabel } from "../attachmentPreview"
import { formatAttachmentSize } from "../AttachmentCard"
import type { ChatAttachment } from "../../../../shared/types"
import { ImageBody } from "./bodies/ImageBody"
import { PdfBody } from "./bodies/PdfBody"
import { MarkdownBody } from "./bodies/MarkdownBody"
import { TableBody } from "./bodies/TableBody"
import { TextBody } from "./bodies/TextBody"
import { JsonBody } from "./bodies/JsonBody"
import { AudioBody } from "./bodies/AudioBody"
import { VideoBody } from "./bodies/VideoBody"
import { CodeBody } from "./bodies/CodeBody"
import { downloadFile, shareViaWebShare } from "./actions"
import type { PreviewSource } from "./types"

interface Props {
  source: PreviewSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FilePreviewSheet({ source, open, onOpenChange }: Props) {
  return (
    <Dialog open={open && source !== null} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="inset-0 h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none p-0 md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[90dvh] md:w-auto md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        {source ? <SheetBody source={source} /> : null}
      </DialogContent>
    </Dialog>
  )
}

export function SheetBody({ source }: { source: PreviewSource }) {
  const meta = useMemo(() => describeMeta(source), [source])

  const handleShare = useCallback(() => {
    void shareViaWebShare(source)
  }, [source])
  const handleDownload = useCallback(() => downloadFile(source), [source])

  return (
    <div className="flex h-full max-h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted md:hidden" role="button" aria-label="Drag down to close" />
        <DialogTitle className="truncate text-base">{source.displayName}</DialogTitle>
        <DialogDescription className="truncate text-xs">{meta}</DialogDescription>
      </div>
      <div key={source.id} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="File preview">
        {createElement(pickBody(source), { source })}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button type="button" variant="outline" onClick={handleShare}>
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
        {source.origin === "offer_download" ? (
          <Button type="button" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function pickBody(source: PreviewSource): React.ComponentType<{ source: PreviewSource }> {
  const attachmentLike: ChatAttachment = {
    id: source.id,
    kind: "file",
    displayName: source.displayName,
    mimeType: source.mimeType,
    size: source.size ?? 0,
    contentUrl: source.contentUrl,
    relativePath: source.relativePath ?? "",
    absolutePath: source.relativePath ?? "",
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  if (iconKind === "image") return ImageBody
  if (iconKind === "pdf") return PdfBody
  if (iconKind === "audio") return AudioBody
  if (iconKind === "video") return VideoBody
  if (iconKind === "table") return TableBody
  if (iconKind === "markdown") return MarkdownBody
  if (iconKind === "json") return JsonBody
  if (iconKind === "code") return CodeBody
  const target = classifyAttachmentPreview(attachmentLike)
  if (target.kind === "external") return PdfBody
  return TextBody
}

function describeMeta(source: PreviewSource): string {
  const attachmentLike: ChatAttachment = {
    id: source.id,
    kind: "file",
    displayName: source.displayName,
    mimeType: source.mimeType,
    size: source.size ?? 0,
    contentUrl: source.contentUrl,
    relativePath: source.relativePath ?? "",
    absolutePath: source.relativePath ?? "",
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  const label = friendlyMimeLabel(iconKind, source.mimeType)
  const size = source.size ? ` · ${formatAttachmentSize(source.size)}` : ""
  return `${label}${size}`
}
