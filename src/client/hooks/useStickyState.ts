import { useEffect, useRef, useState, type RefObject } from "react"

interface UseStickyStateOptions {
  rootRef: RefObject<HTMLElement | null>
  disabled?: boolean
}

export function useStickyState<T extends HTMLElement>({
  rootRef,
  disabled = false,
}: UseStickyStateOptions) {
  const sentinelRef = useRef<T | null>(null)
  const [isStuck, setIsStuck] = useState(false)

  useEffect(() => {
    if (disabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsStuck(false)
      return
    }

    const root = rootRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsStuck(entry.intersectionRatio < 1)
      },
      {
        root,
        threshold: [1],
      }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [disabled, rootRef])

  return { sentinelRef, isStuck }
}
