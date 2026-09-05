
import { engine } from "animejs"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"

export * from "./tokens"

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

export function prefersReducedMotion(dom: DomPort = domAdapter): boolean {
  return dom.matchesMediaQuery(REDUCED_MOTION_QUERY)
}

export function configureMotionEngine(): void {
  engine.pauseOnDocumentHidden = false
  engine.resume()
}
