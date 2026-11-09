import { animate, spring } from "animejs"
import { useLayoutEffect, useRef } from "react"
import { MOTION_SPRING, prefersReducedMotion } from "../lib/motion"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { runDetached } from "../lib/runDetached"


const PROGRESS_VAR = "--kanna-drawer-progress"
const DRAGGING_CLASS = "kanna-drawer-dragging"

const SETTLE_MAX_MS = 420

export interface DrawerVisual {
  track(progress: number): void
  settle(target: 0 | 1): Promise<void>
  present(target: 0 | 1): Promise<void>
  release(): void
}

export function createDrawerVisual(
  dom: DomPort = domAdapter,
  timer: TimerPort = timerAdapter,
): DrawerVisual {
  let current = 0
  let armed = false
  let settledAt: 0 | 1 | null = null

  const write = (progress: number) => {
    current = progress
    dom.setDocumentElementStyleProperty(PROGRESS_VAR, String(progress))
  }

  const release = () => {
    if (!armed) return
    armed = false
    dom.toggleDocumentElementClass(DRAGGING_CLASS, false)
    dom.setDocumentElementStyleProperty(PROGRESS_VAR, "")
  }

  const visual: DrawerVisual = {
    track(progress) {
      if (!armed) {
        armed = true
        dom.toggleDocumentElementClass(DRAGGING_CLASS, true)
      }
      write(progress)
    },

    async settle(target) {
      if (!armed) return
      settledAt = target
      if (prefersReducedMotion(dom) || current === target) {
        write(target)
        release()
        return
      }

      const state = { progress: current }
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        animate(state, {
          progress: target,
          ease: spring(MOTION_SPRING.drawer),
          onUpdate: () => { write(state.progress) },
          onComplete: finish,
        })
        timer.setTimeout(finish, SETTLE_MAX_MS)
      })

      write(target)
      release()
    },

    async present(target) {
      if (armed || settledAt === target) return
      visual.track(target === 1 ? 0 : 1)
      await visual.settle(target)
    },

    release,
  }
  return visual
}

export function usePresentDrawerOnToggle(open: boolean, enabled: boolean, visual: DrawerVisual): void {
  const previous = useRef(open)
  useLayoutEffect(() => {
    if (previous.current === open) return
    previous.current = open
    if (!enabled) return
    runDetached("sidebar drawer present", visual.present(open ? 1 : 0))
  }, [open, enabled, visual])
}
