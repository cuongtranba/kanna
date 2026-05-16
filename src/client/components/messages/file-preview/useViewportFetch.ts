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
  const cached = snippetCache.get(opts.cacheKey) as T | undefined
  const [state, setState] = useState<ViewportFetchState>(cached !== undefined ? "ready" : "idle")
  const [data, setData] = useState<T | null>(cached !== undefined ? cached : null)
  const [error, setError] = useState<Error | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!opts.enabled) return
    if (cached !== undefined) return
    const element = opts.ref.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") return

    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.disconnect()
          if (cancelled) return
          const controller = new AbortController()
          controllerRef.current = controller
          setState("loading")
          opts.fetcher(controller.signal)
            .then((value) => {
              if (cancelled) return
              snippetCache.set(opts.cacheKey, value)
              setData(value)
              setState("ready")
            })
            .catch((err: unknown) => {
              if (cancelled || controller.signal.aborted) return
              setError(err instanceof Error ? err : new Error(String(err)))
              setState("error")
            })
          break
        }
      },
      { rootMargin: opts.rootMargin ?? "200px" },
    )
    io.observe(element)

    return () => {
      cancelled = true
      io.disconnect()
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [cached, opts])

  return useMemo(() => ({ state, data, error }), [state, data, error])
}

export function __clearViewportFetchCacheForTests() {
  snippetCache.clear()
}
