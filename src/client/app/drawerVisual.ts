import { animate, spring } from "animejs"
import { MOTION_SPRING, prefersReducedMotion } from "../lib/motion"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"


const PROGRESS_VAR = "--kanna-drawer-progress"
const DRAGGING_CLASS = "kanna-drawer-dragging"

const SETTLE_MAX_MS = 420

export interface DrawerVisual {
  track(progress: number): void
  settle(target: 0 | 1): Promise<void>
  release(): void
}

export function createDrawerVisual(
  dom: DomPort = domAdapter,
  timer: TimerPort = timerAdapter,
): DrawerVisual {
  let current = 0
  let armed = false

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

  return {
    track(progress) {
      if (!armed) {
        armed = true
        dom.toggleDocumentElementClass(DRAGGING_CLASS, true)
      }
      write(progress)
    },

    async settle(target) {
      if (!armed) return
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

    release,
  }
}
