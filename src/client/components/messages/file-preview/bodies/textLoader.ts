import { useEffect, useState } from "react"
import { TEXT_PREVIEW_LIMIT_BYTES, fetchTextPreview } from "../../attachmentPreview"
import type { PreviewSource } from "../types"

export type TextLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: string; truncated: boolean }

const bodyCache = new Map<string, TextLoadState>()

function cacheKeyFor(source: PreviewSource): string {
  return `${source.id}|${source.contentUrl}|${source.size ?? 0}`
}

export function useTextBodyContent(source: PreviewSource): TextLoadState {
  const cacheKey = cacheKeyFor(source)
  const cached = bodyCache.get(cacheKey)
  const [state, setState] = useState<TextLoadState>(cached ?? { status: "loading" })
  const [lastKey, setLastKey] = useState(cacheKey)

  if (lastKey !== cacheKey) {
    setLastKey(cacheKey)
    setState(bodyCache.get(cacheKey) ?? { status: "loading" })
  }

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    let cancelled = false
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled) return
        const next: TextLoadState = { status: "ready", content: res.content, truncated: res.truncated }
        bodyCache.set(cacheKey, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "Unable to load preview."
        const next: TextLoadState = { status: "error", message: msg }
        bodyCache.set(cacheKey, next)
        setState(next)
      })
    return () => {
      cancelled = true
    }
  }, [cached, cacheKey, source.contentUrl])

  return state
}

export function __clearTextBodyCacheForTests() {
  bodyCache.clear()
}
