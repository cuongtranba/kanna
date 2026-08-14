import { describe, expect, test } from "bun:test"
import {
  clampScrollback,
  DEFAULT_TERMINAL_SCROLLBACK,
  MAX_TERMINAL_SCROLLBACK,
  MIN_TERMINAL_SCROLLBACK,
} from "./terminal-scrollback"

describe("clampScrollback", () => {
  test("non-finite → default", () => {
    expect(clampScrollback(Number.NaN)).toBe(DEFAULT_TERMINAL_SCROLLBACK)
    expect(clampScrollback(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TERMINAL_SCROLLBACK)
  })
  test("below min → min", () => expect(clampScrollback(0)).toBe(MIN_TERMINAL_SCROLLBACK))
  test("above max → max", () => expect(clampScrollback(1_000_000)).toBe(MAX_TERMINAL_SCROLLBACK))
  test("in range rounds to nearest integer", () => expect(clampScrollback(1234.6)).toBe(1235))
})
