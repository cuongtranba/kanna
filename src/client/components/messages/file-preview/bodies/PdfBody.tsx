import type { PreviewSource } from "../types"

export function PdfBody({ source }: { source: PreviewSource }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <iframe
        src={source.contentUrl}
        title={source.displayName}
        sandbox=""
        className="hidden md:block h-[75dvh] w-full rounded-xl border border-border bg-background"
      />
      <a
        href={source.contentUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="md:hidden inline-flex items-center justify-center rounded-xl border border-border bg-muted px-3 py-2 text-sm"
      >
        Open PDF externally
      </a>
    </div>
  )
}
