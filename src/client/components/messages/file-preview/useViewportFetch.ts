import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { AnyValue } from "../../../../shared/errors"

export type ViewportFetchState = "idle" | "loading" | "ready" | "error"

export interface ViewportFetchResult<T> {
  state: ViewportFetchState
  data: T | null
  error: Error | null
}

interface Options<T> {
  ref: RefObject<HTMLElement | null>
  enabled: boolean
  fetcher: (signal: AbortSignal) => Promise<T>
  cacheKey: string
  rootMargin?: string
}

const snippetCache = new Map<string, AnyValue>()
function getCached<T>(key: string): T | undefined {
  const v = snippetCache.get(key)
  return v !== undefined ? <T>v : undefined
}

export function useViewportFetch<T>(opts: Options<T>): ViewportFetchResult<T> {
  const { cacheKey, enabled, ref, fetcher, rootMargin } = opts
  const cached = getCached<T>(cacheKey)
  const [state, setState] = useState<ViewportFetchState>(cached !== undefined ? "ready" : "idle")
  const [data, setData] = useState<T | null>(cached !== undefined ? cached : null)
  const [error, setError] = useState<Error | null>(null)
  const [lastKey, setLastKey] = useState(cacheKey)
  const controllerRef = useRef<AbortController | null>(null)
  const currentKeyRef = useRef(cacheKey)
  currentKeyRef.current = cacheKey

  if (lastKey !== cacheKey) {
    setLastKey(cacheKey)
    const fresh = getCached<T>(cacheKey)
    setState(fresh !== undefined ? "ready" : "idle")
    setData(fresh !== undefined ? fresh : null)
    setError(null)
  }

  useEffect(() => {
    if (!enabled) return
    if (cached !== undefined) return
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") return

    let cancelled = false
    const myKey = cacheKey
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.disconnect()
          if (cancelled) return
          const controller = new AbortController()
          controllerRef.current = controller
          setState("loading")
          fetcher(controller.signal)
            .then((value) => {
              if (cancelled || currentKeyRef.current !== myKey) return
              snippetCache.set(myKey, value)
              setData(value)
              setState("ready")
            })
            .catch((err: AnyValue) => {
              if (cancelled || controller.signal.aborted || currentKeyRef.current !== myKey) return
              setError(err instanceof Error ? err : new Error(String(err)))
              setState("error")
            })
          break
        }
      },
      { rootMargin: rootMargin ?? "200px" },
    )
    io.observe(element)

    return () => {
      cancelled = true
      io.disconnect()
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [cached, cacheKey, enabled, ref, fetcher, rootMargin])

  return useMemo(() => ({ state, data, error }), [state, data, error])
}

export function __clearViewportFetchCacheForTests() {
  snippetCache.clear()
}
