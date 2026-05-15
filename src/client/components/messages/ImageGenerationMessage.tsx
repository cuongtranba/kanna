import type { HydratedImageGenerationToolCall } from "../../../shared/types"

interface Props {
  message: HydratedImageGenerationToolCall
}

export function ImageGenerationMessage({ message }: Props) {
  const status = message.input.status
  const revisedPrompt = message.input.revisedPrompt
  const result = message.result
  const contentUrl = result?.contentUrl
  const isPending = !result || (status && status !== "completed" && status !== "failed")

  if (isPending) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm text-muted-foreground" data-testid="image-generation-pending">
        <span>Generating image{status ? ` (${status})` : "…"}</span>
        {revisedPrompt ? <span className="italic">{revisedPrompt}</span> : null}
      </div>
    )
  }

  if (message.isError || !contentUrl) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" data-testid="image-generation-error">
        <span>Image generation failed.</span>
        {result?.relativePath ? <span className="text-muted-foreground">{result.relativePath}</span> : null}
      </div>
    )
  }

  return (
    <figure className="flex flex-col gap-2" data-testid="image-generation">
      <a href={contentUrl} target="_blank" rel="noreferrer">
        <img
          src={contentUrl}
          alt={revisedPrompt ?? result.fileName ?? "Generated image"}
          className="max-w-full rounded-md border border-border/40"
          loading="lazy"
        />
      </a>
      {revisedPrompt ? (
        <figcaption className="text-xs text-muted-foreground italic">{revisedPrompt}</figcaption>
      ) : null}
    </figure>
  )
}
