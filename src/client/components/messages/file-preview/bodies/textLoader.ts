import { useEffect, useState } from "react"
import { TEXT_PREVIEW_LIMIT_BYTES, fetchTextPreview } from "../../attachmentPreview"
import type { PreviewSource } from "../types"

export type TextLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: string; truncated: boolean }

const bodyCache = new Map<string, TextLoadState>()

export function useTextBodyContent(source: PreviewSource): TextLoadState {
  const cached = bodyCache.get(source.id)
  const [state, setState] = useState<TextLoadState>(cached ?? { status: "loading" })

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    let cancelled = false
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled) return
        const next: TextLoadState = { status: "ready", content: res.content, truncated: res.truncated }
        bodyCache.set(source.id, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "Unable to load preview."
        const next: TextLoadState = { status: "error", message: msg }
        bodyCache.set(source.id, next)
        setState(next)
      })
    return () => {
      cancelled = true
    }
  }, [cached, source.contentUrl, source.id])

  return state
}

export function __clearTextBodyCacheForTests() {
  bodyCache.clear()
}
