import type { PreviewSource } from "../types"

export function AudioBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-3 p-4">
      <div className="text-sm font-medium text-foreground">{source.displayName}</div>
      <audio src={source.contentUrl} controls preload="metadata" className="w-full" />
    </div>
  )
}
