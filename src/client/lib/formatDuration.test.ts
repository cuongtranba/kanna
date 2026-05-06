import { describe, expect, test } from "bun:test"
import { formatCompactDuration, formatLiveDuration } from "./formatDuration"

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
