import { useState } from "react"
import type { HydratedImageGenerationToolCall } from "../../../shared/types"
import { InlinePreviewCard } from "./file-preview/InlinePreviewCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import type { PreviewSource } from "./file-preview/types"

interface Props {
  message: HydratedImageGenerationToolCall
}

export function ImageGenerationMessage({ message }: Props) {
  const { status, revisedPrompt } = message.input
  const result = message.result
  const contentUrl = result?.contentUrl
  const hasFailed = message.isError || status === "failed"
  const [open, setOpen] = useState(false)

  if (!hasFailed && !result && status === "in_progress") {
    return (
      <div
        className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        data-testid="image-generation-pending"
      >
        <span>Generating image…</span>
        {revisedPrompt ? <span className="italic">{revisedPrompt}</span> : null}
      </div>
    )
  }

  if (hasFailed || !result || !contentUrl) {
    return (
      <div
        className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
        data-testid="image-generation-error"
      >
        <span>Image generation failed.</span>
        {result?.relativePath ? <span className="text-muted-foreground">{result.relativePath}</span> : null}
      </div>
    )
  }

  const source: PreviewSource = {
    id: `image-gen-${message.toolId}`,
    contentUrl,
    displayName: result.fileName,
    fileName: result.fileName,
    relativePath: result.relativePath,
    mimeType: "image/png",
    origin: "image_generation",
    altText: revisedPrompt ?? undefined,
  }

  return (
    <figure className="flex flex-col gap-2" data-testid="image-generation">
      <InlinePreviewCard source={source} onOpen={() => setOpen(true)} variant="expanded" />
      {revisedPrompt ? (
        <figcaption className="text-xs text-muted-foreground italic">{revisedPrompt}</figcaption>
      ) : null}
      <FilePreviewSheet source={open ? source : null} open={open} onOpenChange={setOpen} />
    </figure>
  )
}
