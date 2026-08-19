import { describe, expect, test } from "bun:test"
import { formatCompactDuration, formatCountdown, formatLiveDuration } from "./formatDuration"

describe("formatCompactDuration", () => {
  test("under a minute → Ns", () => {
    expect(formatCompactDuration(0)).toBe("0s")
    expect(formatCompactDuration(42_000)).toBe("42s")
    expect(formatCompactDuration(59_999)).toBe("59s")
  })
  test("under an hour → Mm", () => {
    expect(formatCompactDuration(60_000)).toBe("1m")
    expect(formatCompactDuration(120_000)).toBe("2m")
    expect(formatCompactDuration(59 * 60_000)).toBe("59m")
  })
  test("under a day → Hh Mm", () => {
    expect(formatCompactDuration(60 * 60_000)).toBe("1h")
    expect(formatCompactDuration(3_660_000)).toBe("1h 1m")
    expect(formatCompactDuration(23 * 60 * 60_000 + 59 * 60_000)).toBe("23h 59m")
  })
  test("≥ a day → Dd Hh", () => {
    expect(formatCompactDuration(24 * 60 * 60_000)).toBe("1d")
    expect(formatCompactDuration(25 * 60 * 60_000)).toBe("1d 1h")
    expect(formatCompactDuration(48 * 60 * 60_000 + 30 * 60_000)).toBe("2d") // <1h trailing → drop
  })
  test("negative input clamps to 0s", () => {
    expect(formatCompactDuration(-50)).toBe("0s")
  })
})

describe("formatLiveDuration", () => {
  test("under an hour → M:SS", () => {
    expect(formatLiveDuration(0)).toBe("0:00")
    expect(formatLiveDuration(12_000)).toBe("0:12")
    expect(formatLiveDuration(125_000)).toBe("2:05")
    expect(formatLiveDuration(59 * 60_000 + 59_000)).toBe("59:59")
  })
  test("≥ 1h → falls back to compact", () => {
    expect(formatLiveDuration(60 * 60_000)).toBe("1h")
    expect(formatLiveDuration(3_660_000)).toBe("1h 1m")
  })
})

describe("formatCountdown", () => {
  /**
   * The reason this is not `formatCompactDuration`: a 12-minute wait must read
   * "12m" the moment it is set, not "11m" because 11m59.9s floors down.
   */
  test("rounds up, so a wait never reads as already late", () => {
    expect(formatCountdown(12 * 60_000)).toBe("12m")
    expect(formatCountdown(11 * 60_000 + 59_900)).toBe("12m")
    expect(formatCountdown(1)).toBe("1s")
  })
  test("a unit is only used while it still fits", () => {
    expect(formatCountdown(59_900)).toBe("1m")
    expect(formatCountdown(59 * 60_000 + 59_900)).toBe("1h")
    expect(formatCountdown(23 * 60 * 60_000 + 59 * 60_000 + 59_900)).toBe("1d")
  })
  test("reaching zero says zero, and a passed deadline clamps to it", () => {
    expect(formatCountdown(0)).toBe("0s")
    expect(formatCountdown(-5_000)).toBe("0s")
  })
})
