import Markdown from "react-markdown"
import { defaultMarkdownComponents, defaultRemarkPlugins } from "../../shared"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function MarkdownBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><div className="prose hidden" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive">{state.message}</div>
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <div className="prose prose-sm prose-invert max-w-none rounded-xl border border-border bg-background p-4">
        <Markdown remarkPlugins={defaultRemarkPlugins} components={defaultMarkdownComponents}>{state.content}</Markdown>
      </div>
    </div>
  )
}
