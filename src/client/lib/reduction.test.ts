import { describe, expect, test } from "bun:test"
import {
  buildReduction,
  turnDurationsFromMessages,
  MAX_TICKS,
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

  test("the running turn gets its OWN tick, never a completed one re-marked", () => {
    const live = buildReduction([1, 2, 3], { live: true })
    expect(live.ticks).toHaveLength(4)
    expect(live.ticks.map((t) => t.live)).toEqual([false, false, false, true])
    expect(buildReduction([1, 2, 3]).ticks.every((t) => !t.live)).toBe(true)
  })

  test("a first-ever live turn still draws a sigil", () => {
    const { ticks } = buildReduction([], { live: true })
    expect(ticks).toHaveLength(1)
    expect(ticks[0]!.live).toBe(true)
  })

  test("the live tick does not renormalise the completed ones", () => {
    const completed = [100, 200]
    const withoutLive = buildReduction(completed)
    const withLive = buildReduction(completed, { live: true })
    expect(withLive.ticks.slice(0, 2).map((t) => t.topY)).toEqual(
      withoutLive.ticks.map((t) => t.topY),
    )
  })

  test("the live tick takes a slot in the window rather than overflowing it", () => {
    const { ticks } = buildReduction(Array.from({ length: 40 }, (_, i) => i + 1), { live: true })
    expect(ticks).toHaveLength(8)
    expect(ticks.at(-1)!.live).toBe(true)
    for (const tick of ticks) expect(tick.x).toBeLessThan(REDUCTION_SIZE)
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

describe("turnDurationsFromMessages is bounded", () => {
  const result = (durationMs: number) =>
    ({ kind: "result", success: true, result: "", durationMs, id: "r", timestamp: "" }) as never

  test("reads at most the window, and keeps the NEWEST turns in order", () => {
    const many = Array.from({ length: 50 }, (_, i) => result(i + 1))
    const out = turnDurationsFromMessages(many)
    expect(out).toHaveLength(MAX_TICKS)
    expect(out.at(-1)).toBe(50)
    expect(out).toEqual([...out].sort((a, b) => a - b))
  })
})
