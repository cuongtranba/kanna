import { useEffect, useMemo, useRef, type RefObject } from "react"
import { createStore, useStore } from "zustand"
import { onRejected } from "../../../../shared/errors"
import type { JsonValue } from "../../../../shared/json"

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
  fromCache?: (value: JsonValue) => T | undefined
}

const snippetCache = new Map<string, JsonValue>()
function getCached<T extends JsonValue>(
  key: string,
  fromCache: Options<T>["fromCache"],
): T | undefined {
  if (!fromCache) return undefined
  const v = snippetCache.get(key)
  return v !== undefined ? fromCache(v) : undefined
}

interface FetchStoreState<T> {
  state: ViewportFetchState
  data: T | null
  error: Error | null
}

function initialFetchState<T>(cached: T | undefined): FetchStoreState<T> {
  return {
    state: cached !== undefined ? "ready" : "idle",
    data: cached !== undefined ? cached : null,
    error: null,
  }
}

export function useViewportFetch<T extends JsonValue>(opts: Options<T>): ViewportFetchResult<T> {
  const { cacheKey, enabled, ref, fetcher, rootMargin, fromCache } = opts
  const cached = getCached<T>(cacheKey, fromCache)

  const store = useMemo(
    () => createStore<FetchStoreState<T>>(() => initialFetchState(getCached<T>(cacheKey, fromCache))),
    [cacheKey, fromCache],
  )

  const state = useStore(store, (s) => s.state)
  const data = useStore(store, (s) => s.data)
  const error = useStore(store, (s) => s.error)

  const lastKeyRef = useRef(cacheKey)
  const controllerRef = useRef<AbortController | null>(null)
  const currentKeyRef = useRef(cacheKey)
  useEffect(() => {
    currentKeyRef.current = cacheKey
  }, [cacheKey])

  useEffect(() => {
    if (lastKeyRef.current === cacheKey) return
    lastKeyRef.current = cacheKey
    store.setState(initialFetchState(getCached<T>(cacheKey, fromCache)))
  }, [cacheKey, fromCache, store])

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
          store.setState({ state: "loading" })
          fetcher(controller.signal)
            .then((value) => {
              if (cancelled || currentKeyRef.current !== myKey) return
              snippetCache.set(myKey, value)
              store.setState({ data: value, state: "ready" })
            })
            .catch(onRejected((error) => {
              if (cancelled || controller.signal.aborted || currentKeyRef.current !== myKey) return
              store.setState({
                error,
                state: "error",
              })
            }))
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
  }, [cached, cacheKey, enabled, ref, fetcher, rootMargin, store])

  return useMemo(() => ({ state, data, error }), [state, data, error])
}

export function __clearViewportFetchCacheForTests() {
  snippetCache.clear()
}
