import { describe, expect, test } from "bun:test"
import { KEYBOARD_RESIZE_STEP, findResizeBoundary } from "./resize"
import { MIN_PANE_FRACTION } from "./sizes"
import { createGroup, createPane } from "./tree"
import type { PaneNode } from "./types"

const S = KEYBOARD_RESIZE_STEP

function hSplit(): PaneNode {
  return createGroup("g1", "horizontal", [createPane("a"), createPane("b")])
}

function hThree(): PaneNode {
  return createGroup("g1", "horizontal", [createPane("a"), createPane("b"), createPane("c")])
}

function nested(): PaneNode {
  return createGroup("g-out", "vertical", [
    createPane("a"),
    createGroup("g-in", "horizontal", [createPane("b"), createPane("c")]),
  ])
}

describe("findResizeBoundary", () => {
  test("left/right resolve on a horizontal group, up/down find nothing there", () => {
    expect(findResizeBoundary(hSplit(), "a", "right")).toEqual({ groupId: "g1", index: 0, deltaRatio: S })
    expect(findResizeBoundary(hSplit(), "a", "up")).toBeNull()
    expect(findResizeBoundary(hSplit(), "a", "down")).toBeNull()
  })

  test("first child drives the boundary on its right", () => {
    expect(findResizeBoundary(hSplit(), "a", "right")).toEqual({ groupId: "g1", index: 0, deltaRatio: S })
    expect(findResizeBoundary(hSplit(), "a", "left")).toEqual({ groupId: "g1", index: 0, deltaRatio: -S })
  })

  test("middle child drives the boundary on its right", () => {
    expect(findResizeBoundary(hThree(), "b", "right")).toEqual({ groupId: "g1", index: 1, deltaRatio: S })
    expect(findResizeBoundary(hThree(), "b", "left")).toEqual({ groupId: "g1", index: 1, deltaRatio: -S })
  })

  test("last child falls back to the boundary on its left, keeping the sign", () => {
    expect(findResizeBoundary(hThree(), "c", "right")).toEqual({ groupId: "g1", index: 1, deltaRatio: S })
    expect(findResizeBoundary(hThree(), "c", "left")).toEqual({ groupId: "g1", index: 1, deltaRatio: -S })
  })

  test("walks past a wrong-axis parent to the nearest matching ancestor", () => {
    expect(findResizeBoundary(nested(), "b", "right")).toEqual({ groupId: "g-in", index: 0, deltaRatio: S })
    expect(findResizeBoundary(nested(), "b", "down")).toEqual({ groupId: "g-out", index: 0, deltaRatio: S })
    expect(findResizeBoundary(nested(), "b", "up")).toEqual({ groupId: "g-out", index: 0, deltaRatio: -S })
  })

  test("the ancestor walk indexes the branch, not the pane", () => {
    expect(findResizeBoundary(nested(), "c", "down")).toEqual({ groupId: "g-out", index: 0, deltaRatio: S })
    expect(findResizeBoundary(nested(), "c", "right")).toEqual({ groupId: "g-in", index: 0, deltaRatio: S })
  })

  test("a sole root pane has no boundary in any direction", () => {
    const solo = createPane("solo")
    for (const direction of ["left", "right", "up", "down"] as const) {
      expect(findResizeBoundary(solo, "solo", direction)).toBeNull()
    }
  })

  test("an unknown pane id resolves to nothing", () => {
    expect(findResizeBoundary(hSplit(), "missing", "right")).toBeNull()
  })

  test("one nudge can never pin a pane to the floor", () => {
    expect(KEYBOARD_RESIZE_STEP).toBeGreaterThan(0)
    expect(KEYBOARD_RESIZE_STEP).toBeLessThan(MIN_PANE_FRACTION)
  })

  test("an explicit step overrides the default", () => {
    expect(findResizeBoundary(hSplit(), "a", "right", 0.2)).toEqual({
      groupId: "g1",
      index: 0,
      deltaRatio: 0.2,
    })
  })
})
