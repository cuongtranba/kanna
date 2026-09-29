import { Component, useMemo, type ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { contentHash, parseGenUISpec, type GenUIIssue } from "../../../shared/genui"
import { log } from "../../../shared/log"
import { useGenUIHost } from "./host"
import { GenUIView } from "./GenUIView"

const SHOWN_ISSUES = 8

export function GenUIFallback({ issues }: { issues: readonly GenUIIssue[] }) {
  return (
    <div className="not-prose my-3 flex flex-col gap-2 rounded-lg border border-border p-3 text-sm" role="alert">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-warning-text" aria-hidden="true" />
        Unable to show this view
      </p>
      <p className="text-muted-foreground">The agent described a view Kanna could not validate, so nothing from it was run.</p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Details</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono">
          {issues.slice(0, SHOWN_ISSUES).map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>{issue.path ? `${issue.path}: ` : ""}{issue.message}</li>
          ))}
          {issues.length > SHOWN_ISSUES ? <li>…and {issues.length - SHOWN_ISSUES} more</li> : null}
        </ul>
      </details>
    </div>
  )
}

interface BoundaryState {
  failed: boolean
}

class GenUIBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    log.warn("[kanna/genui] view failed to render", { message: error.message })
  }

  render() {
    if (this.state.failed) return <GenUIFallback issues={[{ path: "", message: "The view stopped rendering unexpectedly" }]} />
    return this.props.children
  }
}

export default function GenUIBlock({ source }: { source: string }) {
  const host = useGenUIHost()
  const parsed = useMemo(() => parseGenUISpec(source), [source])
  const viewKey = useMemo(() => `${host.chatId ?? "shared"}:${contentHash(source)}`, [host.chatId, source])
  if (!parsed.ok) return <GenUIFallback issues={parsed.issues} />
  return (
    <GenUIBoundary>
      <GenUIView spec={parsed.spec} viewKey={viewKey} />
    </GenUIBoundary>
  )
}
