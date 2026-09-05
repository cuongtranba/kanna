/**
 * src/client/lib/motion — the motion layer's foundation.
 *
 * Two things live here that no single surface owns:
 *
 *   1. `prefersReducedMotion` — the ONE gate every JS-driven sequence consults.
 *      `src/index.css` already collapses CSS animation and transition durations
 *      under `prefers-reduced-motion: reduce`, but that block cannot reach
 *      anime.js or Motion: both drive `element.style` frame by frame and never
 *      consult the media query. Without this helper the reduced-motion promise
 *      is only half kept, and the half that breaks is the half that moves most.
 *
 *   2. `configureMotionEngine` — anime.js's document-hidden behaviour, set once
 *      at bootstrap (see the function's own note; it is a correctness fix, not
 *      a preference).
 *
 * Timing values are in `./tokens`, re-exported here so a consumer needs one
 * import.
 *
 * Design source: design_handoff_kanna_motion/README.md.
 */

import { engine } from "animejs"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"

export * from "./tokens"

/** The media query that turns every sequence into its end state. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

/**
 * True when the user has asked for reduced motion.
 *
 * Gate a timeline on this and call `tl.complete()` rather than skipping the
 * timeline entirely: the end state is what the UI must look like, and both
 * paths have to reach it identically. A skipped timeline leaves whatever
 * initial styles the sequence wrote — which is how a "reveal" becomes a
 * permanently invisible element.
 *
 * Outside a browser (`matchMedia` absent) this answers `true`. There is nothing
 * to animate there, and answering "reduce" fails towards the end state, which
 * is always the visible one.
 */
export function prefersReducedMotion(dom: DomPort = domAdapter): boolean {
  return dom.matchesMediaQuery(REDUCED_MOTION_QUERY)
}

/**
 * Stops anime.js freezing every running timeline when the tab is backgrounded.
 *
 * `engine.pauseOnDocumentHidden` defaults to `true`, which sounds like a saving
 * and is not: a paused engine holds each animation at whatever fraction it had
 * reached, so switching away mid-transition and back leaves the UI in a state
 * no user action produced — a half-open drawer, a card stranded between board
 * columns, a row at 40% opacity. Kanna is an app people leave open while they
 * watch a build in another tab, so this is the common case rather than the
 * edge one.
 *
 * `resume()` is called as well as flipping the flag because the flag is read at
 * `visibilitychange` time: an engine that already paused stays paused, and
 * nothing later re-reads the flag on its behalf. `resume()` early-returns when
 * the engine is running, so calling it here is idempotent.
 *
 * Call once at client bootstrap. Calling it again is harmless.
 */
export function configureMotionEngine(): void {
  engine.pauseOnDocumentHidden = false
  engine.resume()
}
