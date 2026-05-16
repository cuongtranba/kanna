import { useRef } from "react"
import type { ChatAttachment } from "../../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "../AttachmentCard"
import { classifyAttachmentIcon, friendlyMimeLabel, fetchTextPreview } from "../attachmentPreview"
import { useViewportFetch } from "./useViewportFetch"
import type { PreviewSource } from "./types"

interface Props {
  source: PreviewSource
  onOpen: () => void
  variant: "compact" | "expanded"
}

export function InlinePreviewCard({ source, onOpen, variant }: Props) {
  const attachmentLike: ChatAttachment = {
    id: source.id,
    kind: "file",
    displayName: source.displayName,
    mimeType: source.mimeType,
    size: source.size ?? 0,
    contentUrl: source.contentUrl,
    relativePath: source.relativePath ?? "",
    absolutePath: "",
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  const friendlyType = friendlyMimeLabel(iconKind, source.mimeType)
  const sizeLabel = source.size && source.size > 0 ? formatAttachmentSize(source.size) : null

  if (iconKind === "image") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Preview ${source.displayName}`}
        className="overflow-hidden rounded-xl border border-border bg-background"
      >
        <img
          src={source.contentUrl}
          alt={source.displayName}
          loading="lazy"
          className="max-h-64 w-auto max-w-full object-contain"
        />
      </button>
    )
  }

  if (
    variant === "expanded" &&
    (iconKind === "text" ||
      iconKind === "code" ||
      iconKind === "markdown" ||
      iconKind === "json" ||
      iconKind === "table")
  ) {
    return (
      <SnippetCard source={source} onOpen={onOpen} friendlyType={friendlyType} sizeLabel={sizeLabel} />
    )
  }

  return (
    <AttachmentFileCard
      attachment={attachmentLike}
      onClick={onOpen}
      meta={
        <>
          {friendlyType}
          {sizeLabel ? (
            <>
              {" · "}
              <span className="tabular-nums">{sizeLabel}</span>
            </>
          ) : null}
        </>
      }
      ariaLabel={`Preview ${source.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`}
    />
  )
}

const SnippetCard = function SnippetCardImpl({
  source,
  onOpen,
  friendlyType,
  sizeLabel,
}: {
  source: PreviewSource
  onOpen: () => void
  friendlyType: string
  sizeLabel: string | null
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const result = useViewportFetch<string>({
    ref,
    enabled: true,
    cacheKey: `snippet:${source.id}`,
    fetcher: async (signal) => {
      const res = await fetchTextPreview(source.contentUrl, 4096)
      if (signal.aborted) throw new Error("aborted")
      return res.content.slice(0, 200)
    },
  })
  const snippet = result.state === "ready" && typeof result.data === "string" ? result.data : ""
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`Preview ${source.displayName}`}
      className="flex w-full max-w-md flex-col items-start gap-1 rounded-xl border border-border bg-background p-3 text-left hover:bg-accent/40"
    >
      <div className="text-sm font-medium text-foreground">{source.displayName}</div>
      <div className="text-[11px] text-muted-foreground">
        {friendlyType}
        {sizeLabel ? ` · ${sizeLabel}` : ""}
      </div>
      {snippet ? (
        <pre className="line-clamp-3 max-h-16 w-full whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
          {snippet}
        </pre>
      ) : null}
    </button>
  )
}
