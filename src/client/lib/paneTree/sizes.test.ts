import { describe, expect, test } from "bun:test"
import { MIN_PANE_FRACTION, clampPairSizes, normalizeSizes, redistributeToMinimum } from "./sizes"

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0)
}

describe("normalizeSizes", () => {
  test("returns an empty array for zero children", () => {
    expect(normalizeSizes([], 0)).toEqual([])
  })

  test("gives a single child the whole space", () => {
    expect(normalizeSizes([0.3], 1)).toEqual([1])
  })

  test("scales any positive input to sum 1", () => {
    expect(normalizeSizes([1, 3], 2)).toEqual([0.25, 0.75])
    expect(sum(normalizeSizes([7, 11, 2], 3))).toBeCloseTo(1, 10)
  })

  test("pads a short input and truncates a long one", () => {
    expect(normalizeSizes([1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes([1, 1, 1, 1], 2)).toEqual([0.5, 0.5])
  })

  test("replaces non-finite and non-positive entries rather than propagating them", () => {
    expect(normalizeSizes([Number.NaN, 1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes([0, 1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes([-5, 1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes([Number.POSITIVE_INFINITY, 1], 2)).toEqual([0.5, 0.5])
  })

  test("falls back to a uniform split when nothing usable survives", () => {
    expect(normalizeSizes([0, 0], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25])
  })
})

describe("redistributeToMinimum", () => {
  test("lifts a starved child up to the floor and pays for it from the rest", () => {
    const result = redistributeToMinimum([0.01, 0.99])
    expect(result[0]).toBeCloseTo(MIN_PANE_FRACTION, 10)
    expect(result[1]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
    expect(sum(result)).toBeCloseTo(1, 10)
  })

  test("leaves an already-comfortable split alone", () => {
    const result = redistributeToMinimum([0.5, 0.5])
    expect(result[0]).toBeCloseTo(0.5, 10)
    expect(result[1]).toBeCloseTo(0.5, 10)
  })

  test("goes uniform when the floor is unsatisfiable", () => {
    const result = redistributeToMinimum(Array.from({ length: 11 }, (_, i) => i + 1))
    expect(sum(result)).toBeCloseTo(1, 10)
    for (const value of result) expect(value).toBeCloseTo(1 / 11, 10)
  })

  test("handles the degenerate inputs", () => {
    expect(redistributeToMinimum([])).toEqual([])
    expect(redistributeToMinimum([0.42])).toEqual([1])
  })

  test("always sums to 1 and never returns a child below the floor", () => {
    const cases = [
      [0.001, 0.001, 0.998],
      [1, 1, 1, 1],
      [0.05, 0.05, 0.9],
      [0.9, 0.05, 0.05],
      [0.02, 0.02, 0.02, 0.94],
    ]
    for (const input of cases) {
      const result = redistributeToMinimum(input)
      expect(sum(result)).toBeCloseTo(1, 10)
      for (const value of result) {
        expect(value).toBeGreaterThanOrEqual(MIN_PANE_FRACTION - 1e-9)
      }
    }
  })
})

describe("clampPairSizes", () => {
  test("moves the boundary and preserves the pair's total", () => {
    const result = clampPairSizes([0.5, 0.5], 0, 0.2)
    expect(result[0]).toBeCloseTo(0.7, 10)
    expect(result[1]).toBeCloseTo(0.3, 10)
  })

  test("does not disturb children outside the dragged pair", () => {
    const result = clampPairSizes([0.25, 0.25, 0.5], 0, 0.1)
    expect(result[0]).toBeCloseTo(0.35, 10)
    expect(result[1]).toBeCloseTo(0.15, 10)
    expect(result[2]).toBeCloseTo(0.5, 10)
    expect(sum(result)).toBeCloseTo(1, 10)
  })

  test("clamps at the floor instead of letting a child collapse", () => {
    const result = clampPairSizes([0.5, 0.5], 0, 0.9)
    expect(result[0]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
    expect(result[1]).toBeCloseTo(MIN_PANE_FRACTION, 10)
  })

  test("clamps symmetrically when dragged the other way", () => {
    const result = clampPairSizes([0.5, 0.5], 0, -0.9)
    expect(result[0]).toBeCloseTo(MIN_PANE_FRACTION, 10)
    expect(result[1]).toBeCloseTo(1 - MIN_PANE_FRACTION, 10)
  })

  test("stays draggable when the pair is already smaller than twice the floor", () => {
    const result = clampPairSizes([0.05, 0.05, 0.9], 0, 0.5)
    expect(result[0] + result[1]).toBeCloseTo(0.1, 10)
    expect(result[0]).toBeCloseTo(0.05, 10)
    expect(result[2]).toBeCloseTo(0.9, 10)
  })

  test("returns the input untouched for an out-of-range index", () => {
    const input = [0.5, 0.5]
    expect(clampPairSizes(input, 1, 0.1)).toEqual(input)
    expect(clampPairSizes(input, -1, 0.1)).toEqual(input)
    expect(clampPairSizes(input, 5, 0.1)).toEqual(input)
  })

  test("returns the input untouched for a non-finite delta", () => {
    const input = [0.5, 0.5]
    expect(clampPairSizes(input, 0, Number.NaN)).toEqual(input)
  })
})
