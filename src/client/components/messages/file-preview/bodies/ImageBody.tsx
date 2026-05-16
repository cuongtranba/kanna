import type { PreviewSource } from "../types"

export function ImageBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto">
      <img
        src={source.contentUrl}
        alt={source.altText ?? source.displayName}
        className="max-h-[80dvh] w-auto max-w-full rounded-2xl object-contain"
        style={{ touchAction: "pinch-zoom" }}
      />
    </div>
  )
}
