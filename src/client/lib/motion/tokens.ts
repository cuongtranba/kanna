/**
 * Motion tokens — the single source for every duration and easing the app
 * animates with.
 *
 * These are the JS half of a pair. The CSS half lives in `src/index.css` as
 * `--motion-*` custom properties, and `src/server/design/motion-tokens.test.ts`
 * asserts the two agree value-for-value. That gate is the whole point of the
 * module: a literal `280` typed at a call site is drift no reviewer can see,
 * exactly the way `shellChrome.ts` exists so nobody re-types a band height.
 *
 * Durations are milliseconds as plain numbers because that is what anime.js and
 * Motion both take. CSS reads the `--motion-*` var instead; never the number.
 *
 * Design source: design_handoff_kanna_motion/README.md (§ Design tokens).
 */

import type { SpringParams } from "animejs"

/**
 * How long one movement lasts.
 *
 * `sequence` is the odd one out and is deliberately named as a SUM: the
 * new-session transition (§01) is five beats totalling 860ms, and no single
 * beat inside it may exceed `MAX_BEAT_MS`. Every other entry here is one beat.
 */
export const MOTION_DURATION = {
  /** Press feedback, checkbox fill. */
  instant: 80,
  /** Hover, chevron rotate, colour change. */
  quick: 160,
  /** List rows, tool cards, diff rows, board cards. */
  row: 180,
  /** Terminal, git panel, drawer, sheet, empty state. Already shipped; kept. */
  panel: 280,
  /** Sidebar rows making room for a spawned row. */
  staggerTight: 14,
  /** Project expand cascade. */
  staggerRow: 26,
  /** Transcript tool rows. */
  staggerLoose: 40,
  /** The whole new-session sentence — a sum of beats, not a single tween. */
  sequence: 860,
} as const

export type MotionDurationName = keyof typeof MOTION_DURATION

/**
 * The hard ceiling on a single movement. A sequence may total more (that is
 * what `sequence` is), but nothing the eye reads as one gesture may run longer.
 */
export const MAX_BEAT_MS = 300

/**
 * Duration tokens that describe a SUM rather than one movement, and so are
 * exempt from `MAX_BEAT_MS`. Enumerated rather than inferred so adding a second
 * sequence token is a visible decision.
 */
export const SEQUENCE_DURATIONS: ReadonlySet<MotionDurationName> = new Set(["sequence"])

/**
 * anime.js easing strings.
 *
 * `arriving` covers roughly nine tenths of the app's motion — anything entering
 * the screen. `born` is reserved for the ONE newly-created element per
 * transition; a second overshoot in the same beat reads as bounce, not birth.
 */
export const MOTION_EASE = {
  /** Anything entering the screen. */
  arriving: "out(3)",
  /** The one newly-created element per transition. Never more than one. */
  born: "outBack(1.6)",
  /** Panels. Already shipped as a literal cubic-bezier; kept byte-for-byte. */
  panel: "cubicBezier(0.22, 1, 0.36, 1)",
} as const

export type MotionEaseName = keyof typeof MOTION_EASE

/**
 * CSS equivalents, for the transitions that stay in CSS rather than moving to
 * anime.js. Only the two easings that have a CSS spelling appear here —
 * `born`'s overshoot has no cubic-bezier equivalent, so a CSS consumer that
 * wants it must move to JS.
 *
 * Keys intentionally match `MOTION_EASE`'s so the drift test can pair them.
 */
export const MOTION_EASE_CSS = {
  arriving: "cubic-bezier(0.22, 0.61, 0.36, 1)",
  panel: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const

/**
 * Spring parameters, for the movements whose settle matters more than their
 * duration — a spring's real length is emergent, so it is described here by
 * feel rather than by a number in `MOTION_DURATION`.
 *
 * Each surface adds its own named entry as it lands. Keeping them in one table
 * is what stops `stiffness: 190` from being retyped, slightly differently, in
 * four components.
 */
export const MOTION_SPRING = {
  /** The composer landing at the end of the new-session sentence; press release. */
  landing: { stiffness: 190, damping: 17 },
} as const satisfies Record<string, SpringParams>

export type MotionSpringName = keyof typeof MOTION_SPRING

/**
 * The most elements a stagger may actually stagger. Element 9 onward shares
 * element 8's delay, so a 200-row list never queues a visible wave — the tail
 * of a long list would otherwise still be arriving seconds after the user
 * scrolled past it.
 */
export const STAGGER_LIMIT = 8

/**
 * Clamps a stagger index to `STAGGER_LIMIT`. Use where anime.js's own
 * `stagger(ms, { limit })` is unavailable (Motion variants, CSS delays).
 */
export function staggerDelay(index: number, stepMs: number): number {
  return Math.min(index, STAGGER_LIMIT - 1) * stepMs
}
