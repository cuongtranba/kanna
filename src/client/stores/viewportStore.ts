import { useEffect } from "react"
import { create } from "zustand"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"

interface ViewportState {
  /** Measured window width in px; 0 until the first measurement lands. */
  width: number
  /** Measured window height in px; 0 until the first measurement lands. */
  height: number
  syncViewport: (width: number, height: number) => void
}

/**
 * Shell-level viewport size, measured once for the whole app.
 *
 * `chatPageStore` also tracks a `viewportWidth`, but its subscription only mounts
 * on the chat route — surfaces that live outside it (the sidebar, settings) need
 * a measurement that is always current.
 */
export const useViewportStore = create<ViewportState>()((set) => ({
  width: 0,
  height: 0,
  syncViewport: (width, height) =>
    set((state) => {
      if (!Number.isFinite(width) || !Number.isFinite(height)) return state
      if (state.width === width && state.height === height) return state
      return { width, height }
    }),
}))

/**
 * Mount exactly once, at the app shell. Every other consumer reads the store.
 */
export function useViewportSubscription(ports: { dom: DomPort } = { dom: domAdapter }) {
  const dom = ports.dom
  const syncViewport = useViewportStore((state) => state.syncViewport)

  useEffect(() => {
    const measure = () => syncViewport(dom.getInnerWidth(), dom.getInnerHeight())
    measure()
    return dom.addWindowListener("resize", measure)
  }, [dom, syncViewport])
}
