import { useState, useEffect } from "react"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

const STANDALONE_QUERY = "(display-mode: standalone)"

export function useIsStandalone(ports: { dom: DomPort } = { dom: domAdapter }) {
  const [isStandalone, setIsStandalone] = useState(() => {
    const isIOSStandalone = ports.dom.isIOSStandalone()
    const isDisplayStandalone = ports.dom.matchesMediaQuery(STANDALONE_QUERY)
    return isIOSStandalone || isDisplayStandalone
  })

  useEffect(() => {
    return ports.dom.addMediaQueryListener(STANDALONE_QUERY, (matches) => {
      setIsStandalone(matches || ports.dom.isIOSStandalone())
    })
  }, [ports.dom])

  return isStandalone
}
