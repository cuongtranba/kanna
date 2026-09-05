import { type ReactNode, memo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { MOTION_DURATION, MOTION_EASE_CSS, staggerDelay } from "../../lib/motion"


const ARRIVING: [number, number, number, number] = [0.22, 0.61, 0.36, 1]

export interface MotionRevealProps {
  index: number
  count?: number
  step: number
  y?: number
  x?: number
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

export { AnimatePresence }

export const REVEAL_EASE_CSS = MOTION_EASE_CSS.arriving
