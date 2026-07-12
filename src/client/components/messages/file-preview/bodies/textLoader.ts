import { useEffect, useReducer, useRef } from "react"
import type { AnyValue } from "../../../../../shared/errors"
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

interface TextBodyReducerState {
  loadState: TextLoadState
  lastKey: string
}

type TextBodyAction =
  | { type: "setLoadState"; payload: TextLoadState }
  | { type: "resetForKey"; newKey: string }

function textBodyReducer(state: TextBodyReducerState, action: TextBodyAction): TextBodyReducerState {
  if (action.type === "setLoadState") return { ...state, loadState: action.payload }
  return { lastKey: action.newKey, loadState: bodyCache.get(action.newKey) ?? { status: "loading" } }
}

export function useTextBodyContent(source: PreviewSource): TextLoadState {
  const cacheKey = cacheKeyFor(source)
  const cached = bodyCache.get(cacheKey)
  const [{ loadState, lastKey }, dispatch] = useReducer(textBodyReducer, {
    loadState: cached ?? { status: "loading" },
    lastKey: cacheKey,
  })
  const currentKeyRef = useRef(cacheKey)
  // eslint-disable-next-line react-hooks/refs -- intentional render-time sync write so async fetch completion (which can fire between render and commit) sees the latest key and refuses to overwrite state for a stale key.
  currentKeyRef.current = cacheKey

  // getDerivedStateFromProps pattern: reset state when key changes (same-render update)
  if (lastKey !== cacheKey) {
    dispatch({ type: "resetForKey", newKey: cacheKey })
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
        dispatch({ payload: next, type: "setLoadState" })
      })
      .catch((err: AnyValue) => {
        if (cancelled || currentKeyRef.current !== myKey) return
        const msg = err instanceof Error ? err.message : "Unable to load preview."
        const next: TextLoadState = { status: "error", message: msg }
        bodyCache.set(myKey, next)
        dispatch({ payload: next, type: "setLoadState" })
      })
    return () => {
      cancelled = true
    }
  }, [cached, cacheKey, source.contentUrl])

  return loadState
}

export function __clearTextBodyCacheForTests() {
  bodyCache.clear()
}
