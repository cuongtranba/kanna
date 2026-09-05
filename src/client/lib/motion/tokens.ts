
import type { SpringParams } from "animejs"

export const MOTION_DURATION = {
  instant: 80,
  quick: 160,
  row: 180,
  carry: 240,
  panel: 280,
  staggerTight: 14,
  staggerRow: 26,
  staggerLoose: 40,
  sequence: 860,
} as const

export type MotionDurationName = keyof typeof MOTION_DURATION

export const MAX_BEAT_MS = 300

export const SEQUENCE_DURATIONS: ReadonlySet<MotionDurationName> = new Set(["sequence"])

export const MOTION_EASE = {
  arriving: "out(3)",
  born: "outBack(1.6)",
  panel: "cubicBezier(0.22, 1, 0.36, 1)",
} as const

export type MotionEaseName = keyof typeof MOTION_EASE

export const MOTION_EASE_CSS = {
  arriving: "cubic-bezier(0.22, 0.61, 0.36, 1)",
  panel: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const

export const MOTION_SPRING = {
  landing: { stiffness: 190, damping: 17 },
  indicator: { stiffness: 240, damping: 26 },
  cardTravel: { stiffness: 210, damping: 24 },
  drawer: { stiffness: 210, damping: 22 },
  sheet: { stiffness: 200, damping: 21 },
} as const satisfies Record<string, SpringParams>

export type MotionSpringName = keyof typeof MOTION_SPRING

export const STAGGER_LIMIT = 8

export function staggerDelay(index: number, stepMs: number): number {
  return Math.min(index, STAGGER_LIMIT - 1) * stepMs
}
