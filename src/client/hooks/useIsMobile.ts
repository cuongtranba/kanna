import { useEffect, useState } from "react"

export function useIsMobile(maxWidthPx = 640): boolean {
  const [m, setM] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
  })
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`)
    const handler = () => setM(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [maxWidthPx])
  return m
}
