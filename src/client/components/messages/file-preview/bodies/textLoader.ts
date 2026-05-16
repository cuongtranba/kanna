import { useEffect, useRef, useState } from "react"
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
  const currentKeyRef = useRef(cacheKey)
  // eslint-disable-next-line react-hooks/refs -- intentional render-time sync write so async fetch completion (which can fire between render and commit) sees the latest key and refuses to overwrite state for a stale key.
  currentKeyRef.current = cacheKey

  if (lastKey !== cacheKey) {
    setLastKey(cacheKey)
    setState(bodyCache.get(cacheKey) ?? { status: "loading" })
  }

  useEffect(() => {
    if (cached && cached.status !== "loading") return
    let cancelled = false
    const myKey = cacheKey
    fetchTextPreview(source.contentUrl, TEXT_PREVIEW_LIMIT_BYTES)
      .then((res) => {
        if (cancelled || currentKeyRef.current !== myKey) return
        const next: TextLoadState = { status: "ready", content: res.content, truncated: res.truncated }
        bodyCache.set(myKey, next)
        setState(next)
      })
      .catch((err: unknown) => {
        if (cancelled || currentKeyRef.current !== myKey) return
        const msg = err instanceof Error ? err.message : "Unable to load preview."
        const next: TextLoadState = { status: "error", message: msg }
        bodyCache.set(myKey, next)
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
