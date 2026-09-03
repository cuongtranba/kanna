import { describe, expect, test } from "bun:test"
import {
  buildReduction,
  turnDurationsFromMessages,
  REDUCTION_BASELINE_Y,
  REDUCTION_SIZE,
} from "./reduction"

describe("buildReduction", () => {
  test("one tick per turn, oldest first", () => {
    const { ticks } = buildReduction([100, 200, 300])
    expect(ticks).toHaveLength(3)
    expect(ticks.map((t) => t.x)).toEqual([3, 6, 9])
  })

  test("height encodes duration relative to the longest turn", () => {
    const { ticks } = buildReduction([1000, 500])
    const tall = REDUCTION_BASELINE_Y - ticks[0]!.topY
    const short = REDUCTION_BASELINE_Y - ticks[1]!.topY
    expect(tall).toBeGreaterThan(short)
  })

  test("identical durations draw identical heights", () => {
    const { ticks } = buildReduction([400, 400, 400])
    expect(new Set(ticks.map((t) => t.topY)).size).toBe(1)
  })

  test("is deterministic — the same session always draws the same sigil", () => {
    expect(buildReduction([10, 90, 40], { live: true })).toEqual(
      buildReduction([10, 90, 40], { live: true }),
    )
  })

  test("only the newest tick is live, and only when the session is", () => {
    const live = buildReduction([1, 2, 3], { live: true })
    expect(live.ticks.map((t) => t.live)).toEqual([false, false, true])
    expect(buildReduction([1, 2, 3]).ticks.every((t) => !t.live)).toBe(true)
  })

  test("drops the oldest turns past the window rather than crowding the field", () => {
    const { ticks } = buildReduction(Array.from({ length: 40 }, (_, i) => i + 1))
    expect(ticks).toHaveLength(8)
    expect(ticks.at(-1)!.topY).toBeLessThan(ticks[0]!.topY)
  })

  test("a session with no measured duration still draws its turns", () => {
    const { ticks } = buildReduction([0, 0])
    expect(ticks).toHaveLength(2)
    for (const tick of ticks) expect(tick.topY).toBeLessThan(REDUCTION_BASELINE_Y)
  })

  test("every tick stays inside the field", () => {
    const { ticks } = buildReduction([5, 900, 30, 1200, 7])
    for (const tick of ticks) {
      expect(tick.topY).toBeGreaterThanOrEqual(0)
      expect(tick.x).toBeLessThan(REDUCTION_SIZE)
    }
  })

  test("an empty session draws no ticks", () => {
    expect(buildReduction([]).ticks).toEqual([])
  })
})

describe("turnDurationsFromMessages", () => {
  const result = (durationMs: number, hidden?: boolean) =>
    ({ kind: "result", success: true, result: "", durationMs, id: "r", timestamp: "", hidden }) as never
  const text = () => ({ kind: "assistant_text", text: "hi", id: "a", timestamp: "" }) as never

  test("reads a tick from every visible result, in order", () => {
    expect(turnDurationsFromMessages([result(10), text(), result(20)])).toEqual([10, 20])
  })

  test("a hidden result puts no tick in the picture the reader sees", () => {
    expect(turnDurationsFromMessages([result(10), result(99, true)])).toEqual([10])
  })

  test("a transcript with no results yields no sigil", () => {
    expect(turnDurationsFromMessages([text()])).toEqual([])
  })
})
