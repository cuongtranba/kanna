import type { ChatAttachment } from "../../../../shared/types"

export type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"

export interface PreviewSource {
  id: string
  contentUrl: string
  displayName: string
  fileName: string
  relativePath?: string
  mimeType: string
  size?: number
  origin: PreviewOrigin
}

export function toPreviewSourceFromAttachment(
  attachment: ChatAttachment,
  origin: PreviewOrigin,
): PreviewSource {
  return {
    id: attachment.id,
    contentUrl: attachment.contentUrl ?? "",
    displayName: attachment.displayName,
    fileName: attachment.displayName,
    relativePath: attachment.relativePath,
    mimeType: attachment.mimeType,
    size: attachment.size,
    origin,
  }
}
