import { useEffect, useState } from "react"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export function useIsMobile(
  maxWidthPx = 640,
  ports: { dom: DomPort } = { dom: domAdapter },
): boolean {
  const query = `(max-width: ${maxWidthPx}px)`
  const [m, setM] = useState(() => ports.dom.matchesMediaQuery(query))
  useEffect(() => {
    return ports.dom.addMediaQueryListener(query, setM)
  }, [ports.dom, query])
  return m
}
