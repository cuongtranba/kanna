import type { ChatAttachment } from "../../../../shared/types"

export type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"
  | "image_view"
  | "preview_file"

export interface PreviewSource {
  id: string
  contentUrl: string
  displayName: string
  fileName: string
  relativePath?: string
  mimeType: string
  size?: number
  origin: PreviewOrigin
  altText?: string
}

export function toPreviewSourceFromAttachment(
  attachment: ChatAttachment,
  origin: PreviewOrigin,
): PreviewSource {
  return {
    id: attachment.id,
    contentUrl: attachment.contentUrl,
    displayName: attachment.displayName,
    fileName: attachment.displayName,
    relativePath: attachment.relativePath,
    mimeType: attachment.mimeType,
    size: attachment.size,
    origin,
  }
}

export function attachmentFromPreviewSource(source: PreviewSource): ChatAttachment {
  return {
    id: source.id,
    kind: "file",
    displayName: source.displayName,
    mimeType: source.mimeType,
    size: source.size ?? 0,
    contentUrl: source.contentUrl,
    relativePath: source.relativePath ?? "",
    absolutePath: "",
  }
}
