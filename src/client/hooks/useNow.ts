import { useEffect, useLayoutEffect, useRef, useState } from "react"

/**
 * Returns the current timestamp (ms since epoch), updated on `intervalMs` cadence.
 * Safe to share across many consumers — each mounts its own interval.
 *
 * Typical use: drive age/duration displays without reaching for Date.now() in
 * pure render helpers (kanna-react-style: helpers take args, never read globals).
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState<number>(() => Date.now())
  const savedInterval = useRef(intervalMs)
  useLayoutEffect(() => {
    savedInterval.current = intervalMs
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, savedInterval.current)
    return () => window.clearInterval(id)
  }, [])

  return now
}
