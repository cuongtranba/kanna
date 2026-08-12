import { describe, expect, test } from "bun:test"
import {
  OAUTH_TOKEN_CONCURRENCY_DEFAULT,
  OAUTH_TOKEN_MAX_CONCURRENT_MIN,
  clampTokenConcurrency,
  isTokenConcurrency,
} from "./app-settings-types"

describe("clampTokenConcurrency", () => {
  test("keeps any value at or above the minimum", () => {
    expect(clampTokenConcurrency(1)).toBe(1)
    expect(clampTokenConcurrency(5)).toBe(5)
    expect(clampTokenConcurrency(12)).toBe(12)
    expect(clampTokenConcurrency(500)).toBe(500)
  })

  test("raises below-minimum values to the minimum", () => {
    expect(clampTokenConcurrency(0)).toBe(OAUTH_TOKEN_MAX_CONCURRENT_MIN)
    expect(clampTokenConcurrency(-3)).toBe(OAUTH_TOKEN_MAX_CONCURRENT_MIN)
  })

  test("rounds fractional values", () => {
    expect(clampTokenConcurrency(2.4)).toBe(2)
    expect(clampTokenConcurrency(2.6)).toBe(3)
  })

  test("falls back to the default on non-finite input", () => {
    expect(clampTokenConcurrency(Number.NaN)).toBe(OAUTH_TOKEN_CONCURRENCY_DEFAULT)
    expect(clampTokenConcurrency(Number.POSITIVE_INFINITY)).toBe(OAUTH_TOKEN_CONCURRENCY_DEFAULT)
  })
})

describe("isTokenConcurrency", () => {
  test("accepts finite numbers at or above the minimum, with no upper bound", () => {
    expect(isTokenConcurrency(1)).toBe(true)
    expect(isTokenConcurrency(9)).toBe(true)
    expect(isTokenConcurrency(1000)).toBe(true)
  })

  test("rejects below-minimum and non-finite values", () => {
    expect(isTokenConcurrency(0)).toBe(false)
    expect(isTokenConcurrency(-1)).toBe(false)
    expect(isTokenConcurrency(0.4)).toBe(false)
    expect(isTokenConcurrency(Number.NaN)).toBe(false)
    expect(isTokenConcurrency(Number.POSITIVE_INFINITY)).toBe(false)
  })
})
