import { Download } from "lucide-react"
import type { HydratedOfferDownloadToolCall } from "../../../shared/types"
import { formatAttachmentSize } from "./AttachmentCard"

interface Props {
  message: HydratedOfferDownloadToolCall
}

export function OfferDownloadMessage({ message }: Props) {
  const result = message.result
  if (!result || !result.contentUrl) {
    return null
  }

  const sizeLabel = result.size > 0 ? formatAttachmentSize(result.size) : null
  const meta = [result.mimeType, sizeLabel].filter(Boolean).join(" · ")

  return (
    <div className="flex">
      <a
        href={result.contentUrl}
        target="_blank"
        rel="noreferrer"
        download={result.fileName || undefined}
        className="group flex min-w-0 max-w-[320px] items-center gap-3 rounded-xl border border-border bg-background/85 p-2 pr-4 text-left transition-colors hover:bg-accent/40"
        data-testid="offer-download-link"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
          <Download className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">
            {result.displayName || result.fileName}
          </div>
          {meta ? (
            <div className="truncate text-[11px] text-muted-foreground">{meta}</div>
          ) : null}
        </div>
      </a>
    </div>
  )
}
