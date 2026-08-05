import { describe, expect, test } from "bun:test"
import {
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  TAB_STRIP_HEIGHT,
  computeTabStripLayout,
} from "./tabStripLayout"

const base = { availableWidth: 800, tabCount: 3, actionsWidth: 60 }

describe("computeTabStripLayout", () => {
  test("gives every tab the same width", () => {
    const layout = computeTabStripLayout(base)
    expect(layout.tabWidth).toBeGreaterThan(0)
    expect(Number.isInteger(layout.tabWidth)).toBe(true)
  })

  test("caps a roomy strip so two tabs do not become enormous", () => {
    expect(computeTabStripLayout({ ...base, tabCount: 2 }).tabWidth).toBe(MAX_TAB_WIDTH)
  })

  test("shrinks tabs as more open, before resorting to scrolling", () => {
    const few = computeTabStripLayout({ ...base, tabCount: 3 })
    const many = computeTabStripLayout({ ...base, tabCount: 8 })
    expect(many.tabWidth).toBeLessThan(few.tabWidth)
    expect(many.scrolls).toBe(false)
  })

  // Below the icon-only floor there is nothing left to shrink, so the strip
  // scrolls rather than rendering slivers.
  test("scrolls at the icon-only floor instead of shrinking further", () => {
    const layout = computeTabStripLayout({ availableWidth: 200, tabCount: 12, actionsWidth: 60 })
    expect(layout.tabWidth).toBe(MIN_TAB_WIDTH)
    expect(layout.scrolls).toBe(true)
    expect(layout.showLabel).toBe(false)
  })

  test("drops the label once there is no room for text", () => {
    expect(computeTabStripLayout({ ...base, tabCount: 2 }).showLabel).toBe(true)
    expect(computeTabStripLayout({ availableWidth: 260, tabCount: 4, actionsWidth: 60 }).showLabel).toBe(
      false,
    )
  })

  test("reserves room for the pane's own action buttons", () => {
    const roomy = computeTabStripLayout({ ...base, actionsWidth: 0 })
    const cramped = computeTabStripLayout({ ...base, actionsWidth: 300 })
    expect(cramped.tabWidth).toBeLessThan(roomy.tabWidth)
  })

  test("never returns a width below the floor or above the cap", () => {
    for (const availableWidth of [0, 1, 50, 200, 640, 1600, 4000]) {
      for (const tabCount of [1, 2, 5, 20]) {
        const layout = computeTabStripLayout({ availableWidth, tabCount, actionsWidth: 40 })
        expect(layout.tabWidth).toBeGreaterThanOrEqual(MIN_TAB_WIDTH)
        expect(layout.tabWidth).toBeLessThanOrEqual(MAX_TAB_WIDTH)
      }
    }
  })

  // Static markup renders at width 0; the strip must stay legible rather than
  // collapsing to icon-only in every server-rendered test.
  test("treats an unmeasured strip as roomy", () => {
    const layout = computeTabStripLayout({ availableWidth: 0, tabCount: 2, actionsWidth: 0 })
    expect(layout.tabWidth).toBe(MAX_TAB_WIDTH)
    expect(layout.showLabel).toBe(true)
    expect(layout.scrolls).toBe(false)
  })

  test("handles an empty pane", () => {
    const layout = computeTabStripLayout({ ...base, tabCount: 0 })
    expect(layout.tabWidth).toBe(0)
    expect(layout.scrolls).toBe(false)
  })

  test("the strip height is a fixed, shared constant", () => {
    expect(TAB_STRIP_HEIGHT).toBe(36)
  })
})
