import { animate, spring } from "animejs"
import { MOTION_SPRING, prefersReducedMotion } from "../lib/motion"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"

/**
 * Drawing the mobile drawer while a finger is on it.
 *
 * `evaluateSidebarSwipe` already decides the OUTCOME correctly and its
 * thresholds are untouched here; what was missing is the frames between the
 * finger and the result. This owns those frames and nothing else.
 *
 * **Nothing here re-renders React.** Progress is written as a CSS custom
 * property on the document element and read by one rule in `src/index.css`;
 * a `useState` per touchmove would re-render the whole sidebar sixty times a
 * second to move one transform. Both writes go through `DomPort`, so the
 * client effect seal is intact — no raw `document` anywhere.
 *
 * **The drawer is only rendered mid-drag by CSS**, via the same class that
 * carries the transform. React still owns "is the sidebar open"; the class
 * only makes an already-closed drawer visible for the length of a gesture,
 * so `KannaSidebar` needs no new prop, no new state, and no new line.
 */

/** Written on `<html>`; consumed by the `.kanna-drawer-dragging` rule. */
const PROGRESS_VAR = "--kanna-drawer-progress"
const DRAGGING_CLASS = "kanna-drawer-dragging"

/**
 * A settle long enough for the spring to read as a settle. anime.js derives a
 * spring's real duration from its physics; this is the cap on how long the
 * class stays applied afterwards, not the curve itself.
 */
const SETTLE_MAX_MS = 420

export interface DrawerVisual {
  /** Finger is down at `progress` (0 closed, 1 open). Draws immediately. */
  track(progress: number): void
  /**
   * Finger released. Springs to `target`, then hands the drawer back to React.
   * Resolves when the drawer is settled and the visual has been released.
   */
  settle(target: 0 | 1): Promise<void>
  /** Abandon mid-gesture (touchcancel) without animating. */
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
      // Reduced motion still has to REACH the end state — it just does not
      // travel there. Jumping and releasing is that, in one frame.
      if (prefersReducedMotion(dom) || current === target) {
        write(target)
        release()
        return
      }

      // The tween runs over a plain object rather than an element, so the
      // spring never needs DOM access of its own; every frame is one
      // DomPort write.
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
          // `spring`, not `createSpring`: anime.js 4.5 deprecates the latter
          // and warns on every call. The handoff names `createSpring`, which
          // was current when it was written.
          ease: spring(MOTION_SPRING.drawer),
          onUpdate: () => { write(state.progress) },
          onComplete: finish,
        })
        // A spring that never completes must not strand the drawer half-open
        // with no gesture that recovers it — the class would keep an
        // already-closed drawer on screen, covering the whole viewport.
        timer.setTimeout(finish, SETTLE_MAX_MS)
      })

      write(target)
      release()
    },

    release,
  }
}
