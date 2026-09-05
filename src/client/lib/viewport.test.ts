import { describe, expect, test } from "bun:test"
import { BREAKPOINT_MD, isDesktopViewport, isMobileViewport } from "./viewport"

describe("BREAKPOINT_MD", () => {
  test("is the single md pivot shared by every responsive surface", () => {
    expect(BREAKPOINT_MD).toBe(768)
  })
})

describe("isMobileViewport", () => {
  test("treats an unmeasured viewport as not-mobile", () => {
    expect(isMobileViewport(0)).toBe(false)
  })

  test("treats a nonsensical width as not-mobile", () => {
    expect(isMobileViewport(-1)).toBe(false)
    expect(isMobileViewport(Number.NaN)).toBe(false)
  })

  test("is true strictly below the md pivot", () => {
    expect(isMobileViewport(1)).toBe(true)
    expect(isMobileViewport(375)).toBe(true)
    expect(isMobileViewport(BREAKPOINT_MD - 1)).toBe(true)
  })

  test("is false at and above the md pivot", () => {
    expect(isMobileViewport(BREAKPOINT_MD)).toBe(false)
    expect(isMobileViewport(1440)).toBe(false)
  })
})

describe("isDesktopViewport", () => {
  test("is false for an unmeasured viewport", () => {
    expect(isDesktopViewport(0)).toBe(false)
  })

  test("is true at and above the md pivot", () => {
    expect(isDesktopViewport(BREAKPOINT_MD)).toBe(true)
    expect(isDesktopViewport(1440)).toBe(true)
  })

  test("is false below the md pivot", () => {
    expect(isDesktopViewport(BREAKPOINT_MD - 1)).toBe(false)
  })

  test("never agrees with isMobileViewport for the same width", () => {
    for (const width of [0, 1, 375, 767, 768, 1024, 1440]) {
      expect(isMobileViewport(width) && isDesktopViewport(width)).toBe(false)
    }
  })
})
