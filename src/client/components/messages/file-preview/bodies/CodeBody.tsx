import { useEffect, useState } from "react"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

const SHIKI_SIZE_CEILING = 200 * 1024

function extToLang(name: string): string {
  const i = name.lastIndexOf(".")
  if (i < 0) return "text"
  const ext = name.slice(i + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", go: "go",
    rs: "rust", java: "java", rb: "ruby", sh: "bash", zsh: "bash", yml: "yaml", yaml: "yaml",
    css: "css", scss: "scss", html: "html", json: "json", md: "markdown", sql: "sql",
    cpp: "cpp", c: "c", h: "c", swift: "swift", kt: "kotlin", php: "php", toml: "toml",
  }
  return map[ext] ?? "text"
}

export function CodeBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const shouldHighlight = state.status === "ready" && state.content.length <= SHIKI_SIZE_CEILING
  const highlightKey = shouldHighlight
    ? `${source.id}|${source.contentUrl}|${source.size ?? 0}|${state.content.length}`
    : null
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [lastHighlightKey, setLastHighlightKey] = useState<string | null>(highlightKey)

  if (lastHighlightKey !== highlightKey) {
    setLastHighlightKey(highlightKey)
    setHighlighted(null)
  }

  useEffect(() => {
    if (!shouldHighlight || state.status !== "ready") return
    let cancelled = false
    import("shiki")
      .then(async (mod) => {
        if (cancelled) return
        const html = await mod.codeToHtml(state.content, { lang: extToLang(source.fileName), theme: "github-dark" })
        if (!cancelled) setHighlighted(html)
      })
      .catch(() => {
        if (typeof console !== "undefined") console.warn("[file-preview] Shiki unavailable; falling back to plain text")
      })
    return () => { cancelled = true }
  }, [shouldHighlight, state, source.fileName])

  if (state.status === "loading") return <div className="p-4 text-sm text-muted-foreground"><pre className="sr-only" /> Loading…</div>
  if (state.status === "error") return <div className="p-4 text-sm text-destructive"><pre className="sr-only" /> {state.message}</div>

  if (highlighted) {
    return (
      <div className="overflow-auto p-3 text-xs" dangerouslySetInnerHTML={{ __html: highlighted }} />
    )
  }
  return (
    <div className="space-y-2 overflow-auto p-3">
      {state.truncated ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">Preview truncated to 1024 KB.</div> : null}
      <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 text-xs">{state.content}</pre>
    </div>
  )
}
