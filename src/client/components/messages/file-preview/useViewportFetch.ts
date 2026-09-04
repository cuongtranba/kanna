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
  /**
   * Narrows an entry read back out of the shared cache. One module-level map
   * serves every caller, so its entries are erased to the JSON they actually
   * are — this is the caller's own proof that the entry under its key is the
   * `T` it expects, and the only thing standing in for a cast. It must be
   * reference-stable (module scope or `useCallback`); it feeds an effect.
   * Omit it and a cached entry is simply ignored, so the fetcher runs again.
   */
  fromCache?: (value: JsonValue) => T | undefined
}

/**
 * One module-level cache serves every caller, so the stored value is erased to
 * the JSON it actually is; `Options.fromCache` is what lets a caller read its
 * own entry back out of it.
 */
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

  // `useMemo`, not a lazy ref: the store is READ during render by three
  // `useStore` subscriptions, and reading a ref in render is a React 19
  // violation (`react-hooks/refs`). Keyed on `cacheKey`, so switching keys
  // yields a store already seeded from that key's cache entry.
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
  // Written from an effect, not during render. A resolved fetch can only be
  // observed after commit, so the ref is current by the time anything reads it.
  useEffect(() => {
    currentKeyRef.current = cacheKey
  }, [cacheKey])

  // Reset store state when cacheKey changes
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
