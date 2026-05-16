import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

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

const snippetCache = new Map<string, unknown>()

export function useViewportFetch<T>(opts: Options<T>): ViewportFetchResult<T> {
  const { cacheKey, enabled, ref, fetcher, rootMargin } = opts
  const cached = snippetCache.get(cacheKey) as T | undefined
  const [state, setState] = useState<ViewportFetchState>(cached !== undefined ? "ready" : "idle")
  const [data, setData] = useState<T | null>(cached !== undefined ? cached : null)
  const [error, setError] = useState<Error | null>(null)
  const [lastKey, setLastKey] = useState(cacheKey)
  const controllerRef = useRef<AbortController | null>(null)
  const currentKeyRef = useRef(cacheKey)
  // eslint-disable-next-line react-hooks/refs -- intentional render-time sync write so async fetch completion (which can fire between render and commit) sees the latest key and refuses to overwrite state for a stale key.
  currentKeyRef.current = cacheKey

  if (lastKey !== cacheKey) {
    setLastKey(cacheKey)
    const fresh = snippetCache.get(cacheKey) as T | undefined
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
            .catch((err: unknown) => {
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
