import { describe, expect, test } from "bun:test"
import { STAGGER_LIMIT, staggerDelay } from "../../lib/motion"

describe("cascade delays", () => {
  const step = 26

  test("opening steps away from the header", () => {
    const delays = [0, 1, 2, 3].map((index) => staggerDelay(index, step))
    expect(delays).toEqual([0, 26, 52, 78])
  })

  test("closing folds back towards the header", () => {
    const count = 4
    const exitDelays = [0, 1, 2, 3].map((index) => staggerDelay(count - 1 - index, step))
    expect(exitDelays).toEqual([78, 52, 26, 0])
    expect(exitDelays[count - 1]).toBeLessThan(exitDelays[0])
  })

  test("a long list never queues a wave past the cap", () => {
    const capped = staggerDelay(STAGGER_LIMIT - 1, step)
    expect(staggerDelay(199, step)).toBe(capped)
    expect(capped).toBeLessThan(200)
  })
})
