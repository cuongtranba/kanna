import { useEffect, useMemo, useRef, type RefObject } from "react"
import { createStore, useStore, type StoreApi } from "zustand"
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

interface FetchStoreState<T> {
  state: ViewportFetchState
  data: T | null
  error: Error | null
}

export function useViewportFetch<T>(opts: Options<T>): ViewportFetchResult<T> {
  const { cacheKey, enabled, ref, fetcher, rootMargin } = opts
  const cached = getCached<T>(cacheKey)

  const storeRef = useRef<StoreApi<FetchStoreState<T>> | null>(null)
  if (storeRef.current === null) {
    storeRef.current = createStore<FetchStoreState<T>>(() => ({
      state: cached !== undefined ? "ready" : "idle",
      data: cached !== undefined ? cached : null,
      error: null,
    }))
  }

  const state = useStore(storeRef.current, (s) => s.state)
  const data = useStore(storeRef.current, (s) => s.data)
  const error = useStore(storeRef.current, (s) => s.error)

  const lastKeyRef = useRef(cacheKey)
  const controllerRef = useRef<AbortController | null>(null)
  const currentKeyRef = useRef(cacheKey)
  currentKeyRef.current = cacheKey

  // Reset store state when cacheKey changes
  useEffect(() => {
    if (lastKeyRef.current === cacheKey) return
    lastKeyRef.current = cacheKey
    const fresh = getCached<T>(cacheKey)
    storeRef.current!.setState({
      state: fresh !== undefined ? "ready" : "idle",
      data: fresh !== undefined ? fresh : null,
      error: null,
    })
  }, [cacheKey])

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
          storeRef.current!.setState({ state: "loading" })
          fetcher(controller.signal)
            .then((value) => {
              if (cancelled || currentKeyRef.current !== myKey) return
              snippetCache.set(myKey, value)
              storeRef.current!.setState({ data: value, state: "ready" })
            })
            .catch((err: AnyValue) => {
              if (cancelled || controller.signal.aborted || currentKeyRef.current !== myKey) return
              storeRef.current!.setState({
                error: err instanceof Error ? err : new Error(String(err)),
                state: "error",
              })
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
