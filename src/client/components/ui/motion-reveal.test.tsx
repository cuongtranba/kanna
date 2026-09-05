import { describe, expect, test } from "bun:test"
import { STAGGER_LIMIT, staggerDelay } from "../../lib/motion"

/**
 * MotionReveal's two decisions are both arithmetic on the index, so they are
 * tested as arithmetic. Rendering it would assert Motion's behaviour, not ours.
 */
describe("cascade delays", () => {
  const step = 26

  test("opening steps away from the header", () => {
    const delays = [0, 1, 2, 3].map((index) => staggerDelay(index, step))
    expect(delays).toEqual([0, 26, 52, 78])
  })

  test("closing folds back towards the header", () => {
    // The exit delay MotionReveal computes: staggerDelay(count - 1 - index).
    const count = 4
    const exitDelays = [0, 1, 2, 3].map((index) => staggerDelay(count - 1 - index, step))
    expect(exitDelays).toEqual([78, 52, 26, 0])
    // The last row leaves first — that is the fold. A collapse that staggered
    // from the top instead would read as the list toppling over.
    expect(exitDelays[count - 1]).toBeLessThan(exitDelays[0])
  })

  test("a long list never queues a wave past the cap", () => {
    const capped = staggerDelay(STAGGER_LIMIT - 1, step)
    expect(staggerDelay(199, step)).toBe(capped)
    // Whole-list settle stays bounded regardless of length.
    expect(capped).toBeLessThan(200)
  })
})
