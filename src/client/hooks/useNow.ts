import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { TimerPort } from "../ports/timerPort"
import { timerAdapter } from "../adapters/timer.adapter"

export interface UseNowPorts {
  timer: TimerPort
}

const DEFAULT_PORTS: UseNowPorts = {
  timer: timerAdapter,
}

export function useNow(intervalMs = 1_000, ports?: UseNowPorts): number {
  const { timer } = ports ?? DEFAULT_PORTS
  const [now, setNow] = useState<number>(() => Date.now())
  const savedInterval = useRef(intervalMs)
  useLayoutEffect(() => {
    savedInterval.current = intervalMs
  })

  useEffect(() => {
    const id = timer.setInterval(() => {
      setNow(Date.now())
    }, savedInterval.current)
    return () => timer.clearInterval(id)
  }, [timer])

  return now
}
