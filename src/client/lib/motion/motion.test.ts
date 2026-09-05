import { describe, expect, test } from "bun:test"
import { engine } from "animejs"
import type { DomPort } from "../../ports/domPort"
import { makeFakeDomPort } from "../testing/fakePorts"
import {
  REDUCED_MOTION_QUERY,
  STAGGER_LIMIT,
  configureMotionEngine,
  prefersReducedMotion,
  staggerDelay,
} from "."

function domAnswering(matches: (query: string) => boolean): DomPort {
  return { ...makeFakeDomPort(), matchesMediaQuery: matches }
}

describe("prefersReducedMotion", () => {
  test("asks for the reduced-motion query specifically", () => {
    const asked: string[] = []
    prefersReducedMotion(
      domAnswering((query) => {
        asked.push(query)
        return false
      }),
    )
    expect(asked).toEqual([REDUCED_MOTION_QUERY])
  })

  test("is true when the user asked for reduced motion", () => {
    expect(prefersReducedMotion(domAnswering((q) => q === REDUCED_MOTION_QUERY))).toBe(true)
  })

  test("is false when they did not", () => {
    expect(prefersReducedMotion(domAnswering(() => false))).toBe(false)
  })
})

describe("configureMotionEngine", () => {
  test("stops anime.js pausing on a hidden document", () => {
    engine.pauseOnDocumentHidden = true
    configureMotionEngine()
    expect(engine.pauseOnDocumentHidden).toBe(false)
  })

  test("revives an engine that already paused before it was configured", () => {
    engine.pauseOnDocumentHidden = true
    engine.paused = true
    configureMotionEngine()
    expect(engine.paused).toBe(false)
  })

  test("is idempotent", () => {
    configureMotionEngine()
    configureMotionEngine()
    expect(engine.pauseOnDocumentHidden).toBe(false)
    expect(engine.paused).toBe(false)
  })
})

describe("staggerDelay", () => {
  test("steps linearly inside the cap", () => {
    expect(staggerDelay(0, 40)).toBe(0)
    expect(staggerDelay(3, 40)).toBe(120)
  })

  test("shares the last delay past the cap, so a long list never queues a wave", () => {
    const last = staggerDelay(STAGGER_LIMIT - 1, 40)
    expect(staggerDelay(STAGGER_LIMIT, 40)).toBe(last)
    expect(staggerDelay(200, 40)).toBe(last)
  })
})
