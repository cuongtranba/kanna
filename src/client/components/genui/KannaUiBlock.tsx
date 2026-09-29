import { lazy, Suspense } from "react"
import { LayoutDashboard } from "lucide-react"
import { Spinner } from "../ui/spinner"

const LazyGenUIBlock = lazy(() => import("./GenUIBlock"))

function GenUIPlaceholder({ label }: { label: string }) {
  return (
    <div className="not-prose my-3 flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground" role="status">
      <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
      <Spinner />
      {label}
    </div>
  )
}

export function KannaUiBlock({ source, closed }: { source: string; closed: boolean }) {
  if (!closed) return <GenUIPlaceholder label="Building view…" />
  return (
    <Suspense fallback={<GenUIPlaceholder label="Loading view…" />}>
      <LazyGenUIBlock source={source} />
    </Suspense>
  )
}
