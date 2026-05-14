import { type ReactNode } from "react"
import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  ReceiptText,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react"
import type { ChatAttachment } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { classifyAttachmentIcon, type AttachmentIconKind } from "./attachmentPreview"
import { AttachmentUploadOverlay } from "./AttachmentUploadOverlay"
import { LucideIconWrapper } from "./shared"

type BaseAttachmentCardProps = {
  attachment: ChatAttachment
  previewUrl?: string
  onClick?: () => void
  onRemove?: () => void
  className?: string
  uploadProgress?: number | null
  onCancelUpload?: () => void
}

type AttachmentFileCardProps = BaseAttachmentCardProps & {
  href?: string
  download?: string
  meta?: ReactNode
  ariaLabel?: string
  disabledReason?: string
}

type AttachmentImageCardProps = BaseAttachmentCardProps & {
  size?: "transcript" | "composer"
}

export function AttachmentImageCard({
  attachment,
  previewUrl,
  onClick,
  onRemove,
  className,
  size = "transcript",
  uploadProgress,
  onCancelUpload,
}: AttachmentImageCardProps) {
  const source = attachment.contentUrl || previewUrl
  const isComposer = size === "composer"
  const showUploadOverlay = uploadProgress !== undefined

  return (
    <div className={cn("group relative flex flex-row items-end", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group/image relative overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm",
          isComposer ? "min-w-[80px]" : "min-w-[200px]",
        )}
      >
        {source ? (
          <img
            src={source}
            alt={attachment.displayName}
            className={cn(
              "rounded-xl object-contain bg-muted",
              isComposer
                ? "min-h-[50px] min-w-[80px] max-h-[120px] max-w-[200px]"
                : "min-h-[100px] min-w-[200px] max-h-[300px] max-w-[300px]",
            )}
          />
        ) : (
          <div
            className={cn(
              "flex items-center justify-center rounded-xl bg-muted text-muted-foreground",
              isComposer ? "min-h-[64px] min-w-[80px]" : "min-h-[160px] min-w-[200px]",
            )}
          >
            <FileImage className={cn(isComposer ? "size-6" : "size-8")} />
          </div>
        )}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent text-left opacity-0 transition-opacity duration-200 group-hover/image:opacity-100",
            isComposer ? "px-2.5 pb-2 pt-6" : "px-4 pb-3 pt-10",
          )}
        >
          <div className={cn("truncate font-medium text-white", isComposer ? "text-xs" : "text-sm")}>{attachment.displayName}</div>
          <div className="truncate text-xs text-white/80">
            {attachment.mimeType} · {formatAttachmentSize(attachment.size)}
          </div>
        </div>
      </button>
      {showUploadOverlay ? (
        <AttachmentUploadOverlay
          progress={uploadProgress ?? null}
          onCancel={onCancelUpload}
          size={isComposer ? "sm" : "md"}
          cancelLabel={`Cancel upload of ${attachment.displayName}`}
        />
      ) : null}
      {onRemove && !showUploadOverlay ? <RemoveButton displayName={attachment.displayName} onRemove={onRemove} /> : null}
    </div>
  )
}

export function AttachmentFileCard({
  attachment,
  onClick,
  onRemove,
  className,
  uploadProgress,
  onCancelUpload,
  href,
  download,
  meta,
  ariaLabel,
  disabledReason,
}: AttachmentFileCardProps) {
  const iconKind: AttachmentIconKind = attachment.kind === "mention" ? "text" : classifyAttachmentIcon(attachment)
  const Icon = getAttachmentIcon(iconKind)
  const isMention = attachment.kind === "mention"
  const mentionLabel = isMention ? basename(attachment.displayName) : attachment.displayName
  const mentionSubtitle = isMention ? parentPath(attachment.displayName) : ""
  const showUploadOverlay = uploadProgress !== undefined
  const isDisabled = Boolean(disabledReason)

  const surfaceClass = cn(
    "flex w-[200px] items-center gap-2 rounded-xl border border-border bg-background p-1 pr-3 text-left transition-colors",
    isDisabled
      ? "cursor-not-allowed opacity-60"
      : "hover:bg-accent/50"
  )

  const subtitle = isMention ? (
    <div className="max-w-[150px] truncate text-[11px] text-muted-foreground">
      {mentionSubtitle ? `@${mentionSubtitle}` : "@mention"}
    </div>
  ) : disabledReason ? (
    <div className="truncate text-[11px] text-muted-foreground">{disabledReason}</div>
  ) : meta !== undefined ? (
    <div className="truncate text-[11px] text-muted-foreground">{meta}</div>
  ) : (
    <div className="truncate text-[11px] text-muted-foreground">
      {attachment.mimeType} · {formatAttachmentSize(attachment.size)}
    </div>
  )

  const inner = (
    <>
      <div className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <LucideIconWrapper icon={Icon} className="size-5" />
      </div>
      <div className="min-w-0">
        <div className={cn("max-w-[150px] truncate text-[13px] font-medium", isDisabled ? "text-muted-foreground line-through" : "text-foreground")}>
          {mentionLabel}
        </div>
        {subtitle}
      </div>
    </>
  )

  return (
    <div className={cn("group relative", className)}>
      {href && !isDisabled ? (
        <a
          href={href}
          download={download}
          rel="noopener"
          aria-label={ariaLabel}
          className={surfaceClass}
        >
          {inner}
        </a>
      ) : (
        <button
          type="button"
          onClick={isDisabled ? undefined : onClick}
          title={isMention ? attachment.displayName : undefined}
          aria-label={ariaLabel}
          aria-disabled={isDisabled || undefined}
          disabled={isDisabled}
          className={surfaceClass}
        >
          {inner}
        </button>
      )}
      {showUploadOverlay ? (
        <AttachmentUploadOverlay
          progress={uploadProgress ?? null}
          onCancel={onCancelUpload}
          size="sm"
          cancelLabel={`Cancel upload of ${attachment.displayName}`}
        />
      ) : null}
      {onRemove && !showUploadOverlay ? <RemoveButton displayName={attachment.displayName} onRemove={onRemove} /> : null}
    </div>
  )
}

function basename(relativePath: string): string {
  const cleaned = relativePath.replace(/\/+$/, "")
  const idx = cleaned.lastIndexOf("/")
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

function parentPath(relativePath: string): string {
  const cleaned = relativePath.replace(/\/+$/, "")
  const idx = cleaned.lastIndexOf("/")
  return idx >= 0 ? cleaned.slice(0, idx) : ""
}

function RemoveButton({ displayName, onRemove }: { displayName: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="absolute right-2 top-2 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onRemove()
      }}
      aria-label={`Remove ${displayName}`}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  )
}

function getAttachmentIcon(kind: AttachmentIconKind): LucideIcon {
  switch (kind) {
    case "image":
      return FileImage
    case "pdf":
      return ReceiptText
    case "markdown":
      return ScrollText
    case "json":
      return FileJson
    case "table":
      return FileSpreadsheet
    case "code":
      return FileCode2
    case "text":
      return FileText
    case "archive":
      return FileArchive
    case "audio":
      return FileAudio
    case "video":
      return FileVideoCamera
    default:
      return File
  }
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
