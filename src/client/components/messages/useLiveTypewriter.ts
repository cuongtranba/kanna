import { useCallback, useEffect, useMemo, useReducer } from "react"
import type { DomPort, TimerPort } from "../../ports"
import { prefersReducedMotion } from "../../lib/motion"
import {
  INITIAL_TYPEWRITER_STATE,
  syncSnapshot,
  typewriterReducer,
  viewOf,
  type TypewriterView,
} from "./live-typewriter"

export interface LiveTypewriter extends TypewriterView {
  reducedMotion: boolean
}

export function useLiveTypewriter(text: string, timer: TimerPort, dom: DomPort): LiveTypewriter {
  const reducedMotion = prefersReducedMotion(dom)
  const [state, dispatch] = useReducer(typewriterReducer, INITIAL_TYPEWRITER_STATE)
  const synced = useMemo(() => syncSnapshot(state, text), [state, text])
  const view = useMemo(() => viewOf(synced, reducedMotion), [synced, reducedMotion])
  const onFrame = useCallback(
    (timestamp: number) => dispatch({ type: "frame", timestamp, text }),
    [text],
  )
  const frames = synced.frames
  const scheduling = view.revealing && !reducedMotion

  useEffect(() => {
    if (!scheduling) return
    const frameId = timer.requestAnimationFrame(onFrame)
    return () => timer.cancelAnimationFrame(frameId)
  }, [scheduling, timer, onFrame, frames])

  return { ...view, reducedMotion }
}
