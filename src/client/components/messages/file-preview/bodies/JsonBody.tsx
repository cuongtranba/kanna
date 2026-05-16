import { useMemo } from "react"
import { prettifyJson } from "../../attachmentPreview"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function JsonBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const pretty = useMemo(() => (state.status === "ready" ? prettifyJson(state.content) : ""), [state])
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{pretty}</pre>
    </div>
  )
}
