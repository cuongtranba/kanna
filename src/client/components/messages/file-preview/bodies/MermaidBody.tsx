import { MermaidDiagram } from "../../MermaidDiagram"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function MermaidBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") {
    return <div className="p-4 text-sm text-muted-foreground"><div className="hidden" /> Loading…</div>
  }
  if (state.status === "error") {
    return <div className="p-4 text-sm text-destructive">{state.message}</div>
  }
  return (
    <div className="p-4">
      <MermaidDiagram source={state.content} />
    </div>
  )
}
