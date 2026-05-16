import { useEffect, useRef, useState } from "react"
import {
  TABLE_PREVIEW_COLUMN_LIMIT,
  TEXT_PREVIEW_LIMIT_BYTES,
  fetchTextPreview,
  parseDelimitedPreview,
  type TablePreviewData,
} from "../../attachmentPreview"
import type { PreviewSource } from "../types"

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: TablePreviewData; truncated: boolean }

const cache = new Map<string, State>()

export function __clearTableBodyCacheForTests() {
  cache.clear()
}

function cacheKeyFor(source: PreviewSource): string {
  return `${source.id}|${source.contentUrl}|${source.size ?? 0}|${source.mimeType}`
}

export function TableBody({ source }: { source: PreviewSource }) {
  const cacheKey = cacheKeyFor(source)
  const cached = cache.get(cacheKey)
  const [state, setState] = useState<State>(cached ?? { status: "loading" })
  const [lastKey, setLastKey] = useState(cacheKey)
  const currentKeyRef = useRef(cacheKey)
  // eslint-disable-next-line react-hooks/refs -- intentional render-time sync write so async fetch completion (which can fire between render and commit) sees the latest key and refuses to overwrite state for a stale key.
  currentKeyRef.current = cacheKey

  if (lastKey !== cacheKey) {
    setLastKey(cacheKey)
    setState(cache.get(cacheKey) ?? { status: "loading" })
  }

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    const delimiter = source.mimeType === "text/tab-separated-values" ? "\t" : ","
    let cancelled = false
    const myKey = cacheKey
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled || currentKeyRef.current !== myKey) return
        const next: State = { status: "ready", table: parseDelimitedPreview(res.content, delimiter), truncated: res.truncated }
        cache.set(myKey, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled || currentKeyRef.current !== myKey) return
        const next: State = { status: "error", message: err instanceof Error ? err.message : "Unable to load preview." }
        cache.set(myKey, next)
        setState(next)
      })
    return () => { cancelled = true }
  }, [cached, cacheKey, source.contentUrl, source.mimeType])

  if (state.status === "loading") {
    return <div className="p-4 text-sm text-muted-foreground"><table className="sr-only" /> Loading…</div>
  }
  if (state.status === "error") {
    return <div className="p-4 text-sm text-destructive"><table className="sr-only" /> {state.message}</div>
  }
  const { table } = state
  const [header, ...body] = table.rows
  const notices = [
    state.truncated ? "Preview truncated to 1024 KB." : null,
    table.truncatedRows ? `Showing first ${table.rows.length} of ${table.rowCount} rows.` : null,
    table.truncatedColumns ? `Showing first ${TABLE_PREVIEW_COLUMN_LIMIT} of ${table.columnCount} columns.` : null,
  ].filter(Boolean)
  return (
    <div className="space-y-2 overflow-auto p-3">
      {notices.length ? <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">{notices.join(" ")}</div> : null}
      <div className="max-h-[70dvh] overflow-auto rounded-xl border border-border bg-background">
        <table className="min-w-full border-collapse text-xs">
          {header ? (
            <thead className="sticky top-0 bg-muted">
              <tr>{header.map((c, i) => <th key={i} className="border-b border-border px-3 py-2 text-left font-medium">{c || " "}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="odd:bg-background even:bg-muted/20">
                {row.map((c, ci) => <td key={ci} className="max-w-[320px] border-b border-border px-3 py-2 align-top"><div className="whitespace-pre-wrap break-words">{c || " "}</div></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
