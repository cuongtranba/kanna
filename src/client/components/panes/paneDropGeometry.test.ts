import { describe, expect, test } from "bun:test"
import {
  MERGE_ZONE_RATIO,
  resolvePaneDropIntent,
  resolveTabInsertionIndex,
} from "./paneDropGeometry"

const rect = { left: 0, top: 0, width: 200, height: 100 }

const at = (x: number, y: number) => resolvePaneDropIntent({ pointer: { x, y }, rect })

describe("resolvePaneDropIntent", () => {
  test("the centre of the pane merges", () => {
    expect(at(100, 50)).toEqual({ kind: "merge" })
  })

  test("the merge zone spans the middle 40% on both axes", () => {
    expect(MERGE_ZONE_RATIO).toBe(0.4)

    expect(at(61, 50)).toEqual({ kind: "merge" })
    expect(at(139, 50)).toEqual({ kind: "merge" })
    expect(at(100, 31)).toEqual({ kind: "merge" })
    expect(at(100, 69)).toEqual({ kind: "merge" })
  })

  test("just outside the merge zone splits toward the nearest edge", () => {
    expect(at(59, 50)).toEqual({ kind: "split", position: "left" })
    expect(at(141, 50)).toEqual({ kind: "split", position: "right" })
    expect(at(100, 29)).toEqual({ kind: "split", position: "top" })
    expect(at(100, 71)).toEqual({ kind: "split", position: "bottom" })
  })

  test("the outer frame splits toward its own edge", () => {
    expect(at(4, 50)).toEqual({ kind: "split", position: "left" })
    expect(at(196, 50)).toEqual({ kind: "split", position: "right" })
    expect(at(100, 2)).toEqual({ kind: "split", position: "top" })
    expect(at(100, 98)).toEqual({ kind: "split", position: "bottom" })
  })

  test("a corner resolves to the proportionally nearer edge", () => {
    expect(at(10, 10)).toEqual({ kind: "split", position: "left" })
    expect(at(30, 4)).toEqual({ kind: "split", position: "top" })
  })

  test("respects the pane's offset in the page", () => {
    const offset = { left: 500, top: 300, width: 200, height: 100 }

    expect(resolvePaneDropIntent({ pointer: { x: 600, y: 350 }, rect: offset })).toEqual({
      kind: "merge",
    })
    expect(resolvePaneDropIntent({ pointer: { x: 505, y: 350 }, rect: offset })).toEqual({
      kind: "split",
      position: "left",
    })
  })

  test("clamps a pointer that has drifted outside the pane", () => {
    expect(at(-40, 50)).toEqual({ kind: "split", position: "left" })
    expect(at(240, 50)).toEqual({ kind: "split", position: "right" })
  })

  test("merges into a pane too small to split meaningfully", () => {
    const tiny = { left: 0, top: 0, width: 0, height: 0 }

    expect(resolvePaneDropIntent({ pointer: { x: 0, y: 0 }, rect: tiny })).toEqual({
      kind: "merge",
    })
  })
})

describe("resolveTabInsertionIndex", () => {
  const strip = { left: 0, width: 400 }

  test("drops before the first tab when left of its midpoint", () => {
    expect(resolveTabInsertionIndex({ pointerX: 10, strip, tabCount: 4, tabWidth: 100 })).toBe(0)
  })

  test("drops after a tab once past its midpoint", () => {
    expect(resolveTabInsertionIndex({ pointerX: 60, strip, tabCount: 4, tabWidth: 100 })).toBe(1)
    expect(resolveTabInsertionIndex({ pointerX: 160, strip, tabCount: 4, tabWidth: 100 })).toBe(2)
  })

  test("drops at the end when past the last tab", () => {
    expect(resolveTabInsertionIndex({ pointerX: 390, strip, tabCount: 4, tabWidth: 100 })).toBe(4)
    expect(resolveTabInsertionIndex({ pointerX: 900, strip, tabCount: 4, tabWidth: 100 })).toBe(4)
  })

  test("returns 0 for an empty strip", () => {
    expect(resolveTabInsertionIndex({ pointerX: 50, strip, tabCount: 0, tabWidth: 100 })).toBe(0)
  })

  test("never exceeds the tab count", () => {
    const index = resolveTabInsertionIndex({ pointerX: 10_000, strip, tabCount: 2, tabWidth: 100 })

    expect(index).toBe(2)
  })

  test("treats a zero tab width as an append rather than dividing by zero", () => {
    expect(resolveTabInsertionIndex({ pointerX: 50, strip, tabCount: 3, tabWidth: 0 })).toBe(3)
  })
})
