import { fileNameOfPath } from "../../lib/pathUtils"
import { InlinePreviewCard } from "./file-preview/InlinePreviewCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import type { PreviewSource } from "./file-preview/types"
import { ImageViewMessageStore } from "./ImageViewMessage.store"

interface Props {
  toolId: string
  path: string
  contentUrl: string
  mimeType: string
}

function ImageViewMessageInner({ toolId, path, contentUrl, mimeType }: Props) {
  const open = ImageViewMessageStore.useScopedStore((s) => s.open)
  const setOpen = ImageViewMessageStore.useScopedStore((s) => s.setOpen)
  const fileName = fileNameOfPath(path)

  if (!contentUrl) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        {path}
      </div>
    )
  }

  const source: PreviewSource = {
    id: `image-view-${toolId}`,
    contentUrl,
    displayName: fileName,
    fileName,
    relativePath: path,
    mimeType,
    origin: "image_view",
  }

  return (
    <figure className="flex flex-col gap-2" data-testid="image-view">
      <InlinePreviewCard source={source} onOpen={() => setOpen(true)} variant="expanded" />
      <FilePreviewSheet source={open ? source : null} open={open} onOpenChange={setOpen} />
    </figure>
  )
}

export function ImageViewMessage(props: Props) {
  return (
    <ImageViewMessageStore.Provider init={undefined}>
      <ImageViewMessageInner {...props} />
    </ImageViewMessageStore.Provider>
  )
}
