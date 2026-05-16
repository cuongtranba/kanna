import type { PreviewSource } from "../types"

export function VideoBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full items-center justify-center bg-black/40 p-2">
      <video src={source.contentUrl} controls playsInline preload="metadata" className="max-h-[60dvh] w-full rounded-xl" />
    </div>
  )
}
