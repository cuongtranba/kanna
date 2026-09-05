import { type ReactNode, memo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { MOTION_DURATION, MOTION_EASE_CSS, staggerDelay } from "../../lib/motion"

/**
 * One row arriving as part of a sequence.
 *
 * Four surfaces want the same gesture — sidebar rows cascading out of a project
 * header (§02), tool rows landing in the transcript (§03), diff rows arriving
 * after the git panel has settled (§04), and settings rows on a section change
 * (§06). They differ only in step, travel and axis, so they share one component
 * rather than four near-copies that drift.
 *
 * Two behaviours here are load-bearing rather than decorative:
 *
 * **The delay is capped** (`staggerDelay` → `STAGGER_LIMIT`). Element 9 onward
 * shares element 8's delay, so a 200-row list never queues a visible wave whose
 * tail is still arriving after the user has scrolled past it.
 *
 * **The exit folds from the far end.** A collapse that staggers from the top
 * reads as the list falling over; from the bottom it reads as folding shut
 * towards its header. Pass `count` to get that; without it, exit mirrors enter.
 *
 * Reduced motion is handled globally by `<MotionConfig reducedMotion="user">`
 * in `App.tsx` — Motion then drops the transform and keeps the end state, so
 * there is deliberately no per-component gate here.
 */

/** The easing every arrival uses, as Motion's numeric bezier tuple. */
const ARRIVING: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

export interface MotionRevealProps {
  /** Position in the list. Drives the stagger delay. */
  index: number
  /**
   * Total rows. When given, the exit delay is measured from the far end so the
   * group folds towards its header instead of toppling away from it.
   */
  count?: number
  /** Milliseconds between neighbours — one of MOTION_DURATION's stagger tokens. */
  step: number
  /** Vertical travel in px. Negative arrives from above. */
  y?: number
  /** Horizontal travel in px. Negative arrives from the left. */
  x?: number
  /** Beat length. Defaults to the row token. */
  durationMs?: number
  className?: string
  children: ReactNode
}

function MotionRevealImpl({
  index,
  count,
  step,
  y = 0,
  x = 0,
  durationMs = MOTION_DURATION.row,
  className,
  children,
}: MotionRevealProps) {
  const enterDelay = staggerDelay(index, step)
  const exitDelay = count === undefined ? enterDelay : staggerDelay(count - 1 - index, step)

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, x }}
      animate={{
        opacity: 1,
        y: 0,
        x: 0,
        transition: { duration: durationMs / 1000, ease: ARRIVING, delay: enterDelay / 1000 },
      }}
      exit={{
        opacity: 0,
        y,
        x,
        transition: { duration: durationMs / 1000, ease: ARRIVING, delay: exitDelay / 1000 },
      }}
    >
      {children}
    </motion.div>
  )
}

export const MotionReveal = memo(MotionRevealImpl)

/**
 * Re-exported so a consumer that needs enter/exit gets both from one import,
 * and so `motion/react` itself stays an implementation detail of this module
 * for the row-reveal case.
 */
export { AnimatePresence }

/** The CSS easing string, for the rules that stay in CSS beside these rows. */
export const REVEAL_EASE_CSS = MOTION_EASE_CSS.arriving
