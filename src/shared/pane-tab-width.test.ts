import { describe, expect, test } from "bun:test"
import {
  DEFAULT_TAB_MIN_WIDTH,
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  clampTabMinWidth,
} from "./pane-tab-width"

describe("clampTabMinWidth", () => {
  test("keeps a value inside the range and rounds it", () => {
    expect(clampTabMinWidth(120)).toBe(120)
    expect(clampTabMinWidth(120.6)).toBe(121)
  })

  test("pulls a value outside the range back to the nearest bound", () => {
    expect(clampTabMinWidth(10)).toBe(MIN_TAB_WIDTH)
    expect(clampTabMinWidth(10_000)).toBe(MAX_TAB_WIDTH)
  })

  test("falls back to the default for anything that is not a finite number", () => {
    for (const bad of [undefined, Number.NaN, Infinity, {}, "wide"]) {
      expect(clampTabMinWidth(bad)).toBe(DEFAULT_TAB_MIN_WIDTH)
    }
  })

  test("coerces a numeric string, like the rest of app-settings does", () => {
    // settings.json is hand-editable, so "120" is a value a real file can hold.
    expect(clampTabMinWidth("120")).toBe(120)
  })

  test("the default reproduces the pre-preference behaviour", () => {
    // Tabs used to shrink all the way to the icon-only floor, so the default
    // has to BE that floor or every existing layout would change on upgrade.
    expect(DEFAULT_TAB_MIN_WIDTH).toBe(MIN_TAB_WIDTH)
  })
})
