import { describe, expect, test } from "bun:test"
import {
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  PHONE_MIN_TAB_WIDTH,
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
})

// A phone raises the floor: every chat tab carries the same icon, so a strip
// that shrank to icon-only would be six identical slivers. It scrolls instead.
describe("computeTabStripLayout with a raised floor", () => {
  const phone = { availableWidth: 390, actionsWidth: 0, minTabWidth: PHONE_MIN_TAB_WIDTH }

  test("scrolls at the raised floor, keeping the label", () => {
    const layout = computeTabStripLayout({ ...phone, tabCount: 6 })

    expect(layout.tabWidth).toBe(PHONE_MIN_TAB_WIDTH)
    expect(layout.scrolls).toBe(true)
    expect(layout.showLabel).toBe(true)
  })

  test("the same strip on the default floor goes icon-only instead", () => {
    const layout = computeTabStripLayout({ availableWidth: 390, actionsWidth: 0, tabCount: 6 })

    expect(layout.scrolls).toBe(false)
    expect(layout.showLabel).toBe(false)
  })

  test("still fills the strip while the tabs fit", () => {
    const layout = computeTabStripLayout({ ...phone, tabCount: 3 })

    expect(layout.scrolls).toBe(false)
    expect(layout.tabWidth).toBe(130)
  })

  test("a floor above the cap cannot push a tab past the cap", () => {
    const layout = computeTabStripLayout({ ...phone, tabCount: 2, minTabWidth: 1000 })

    expect(layout.tabWidth).toBe(MAX_TAB_WIDTH)
  })

  test("a floor below the icon-only width cannot shrink a tab past it", () => {
    const layout = computeTabStripLayout({ ...phone, tabCount: 20, minTabWidth: 4 })

    expect(layout.tabWidth).toBe(MIN_TAB_WIDTH)
  })

  test("an unmeasured strip stays roomy whatever the floor", () => {
    const layout = computeTabStripLayout({ ...phone, availableWidth: 0, tabCount: 6 })

    expect(layout.tabWidth).toBe(MAX_TAB_WIDTH)
    expect(layout.scrolls).toBe(false)
  })
})
