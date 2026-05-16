import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function TextBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <Notice>Preview truncated to 1024 KB.</Notice> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{state.content}</pre>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{children}</div>
}
