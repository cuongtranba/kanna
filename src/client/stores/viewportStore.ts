import { useEffect } from "react"
import { create } from "zustand"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"

interface ViewportState {
  width: number
  height: number
  syncViewport: (width: number, height: number) => void
}

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

export function useViewportSubscription(ports: { dom: DomPort } = { dom: domAdapter }) {
  const dom = ports.dom
  const syncViewport = useViewportStore((state) => state.syncViewport)

  useEffect(() => {
    const measure = () => syncViewport(dom.getInnerWidth(), dom.getInnerHeight())
    measure()
    return dom.addWindowListener("resize", measure)
  }, [dom, syncViewport])
}
