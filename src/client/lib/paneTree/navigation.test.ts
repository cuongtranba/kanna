import { describe, expect, test } from "bun:test"
import { collectPaneBounds, findAdjacentPane } from "./navigation"
import { createGroup, createPane } from "./tree"
import type { PaneNode } from "./types"

/**
 *  ┌─────────┬─────────┐
 *  │   pa    │   pb    │
 *  ├─────────┤         │
 *  │   pc    │         │
 *  └─────────┴─────────┘
 * Left column split vertically; right column a single tall pane.
 */
function lShaped(): PaneNode {
  return createGroup("root", "horizontal", [
    createGroup("left", "vertical", [createPane("pa"), createPane("pc")]),
    createPane("pb"),
  ])
}

describe("collectPaneBounds", () => {
  test("assigns normalized rects by accumulating group sizes", () => {
    const bounds = collectPaneBounds(lShaped())
    const byId = new Map(bounds.map((entry) => [entry.paneId, entry.rect]))

    expect(byId.get("pa")).toEqual({ left: 0, top: 0, right: 0.5, bottom: 0.5 })
    expect(byId.get("pc")).toEqual({ left: 0, top: 0.5, right: 0.5, bottom: 1 })
    expect(byId.get("pb")).toEqual({ left: 0.5, top: 0, right: 1, bottom: 1 })
  })

  test("a lone pane fills the whole space", () => {
    expect(collectPaneBounds(createPane("only"))).toEqual([
      { paneId: "only", rect: { left: 0, top: 0, right: 1, bottom: 1 } },
    ])
  })
})

describe("findAdjacentPane", () => {
  test("moves right and left across the top row", () => {
    const root = lShaped()
    expect(findAdjacentPane(root, "pa", "right")).toBe("pb")
    expect(findAdjacentPane(root, "pb", "left")).toBe("pa")
  })

  test("moves down and up within the left column", () => {
    const root = lShaped()
    expect(findAdjacentPane(root, "pa", "down")).toBe("pc")
    expect(findAdjacentPane(root, "pc", "up")).toBe("pa")
  })

  // A pure tree walk would answer "pb" for pc→up, because pb is pc's uncle.
  // Geometry gives the answer a user expects.
  test("does not leave the column when moving up from the lower-left pane", () => {
    expect(findAdjacentPane(lShaped(), "pc", "up")).not.toBe("pb")
  })

  test("crosses out of a nested group when moving right", () => {
    expect(findAdjacentPane(lShaped(), "pc", "right")).toBe("pb")
  })

  test("returns null at an edge", () => {
    const root = lShaped()
    expect(findAdjacentPane(root, "pa", "left")).toBeNull()
    expect(findAdjacentPane(root, "pa", "up")).toBeNull()
    expect(findAdjacentPane(root, "pb", "right")).toBeNull()
    expect(findAdjacentPane(root, "pc", "down")).toBeNull()
  })

  test("returns null for a lone pane in every direction", () => {
    const only = createPane("only")
    for (const direction of ["left", "right", "up", "down"] as const) {
      expect(findAdjacentPane(only, "only", direction)).toBeNull()
    }
  })

  test("returns null for an unknown pane", () => {
    expect(findAdjacentPane(lShaped(), "ghost", "left")).toBeNull()
  })

  test("prefers the nearest candidate, then the best overlap", () => {
    //  pa | pb | pc  — from pa, "right" must stop at pb, not skip to pc.
    const row = createGroup("root", "horizontal", [
      createPane("pa"),
      createPane("pb"),
      createPane("pc"),
    ])
    expect(findAdjacentPane(row, "pa", "right")).toBe("pb")
    expect(findAdjacentPane(row, "pc", "left")).toBe("pb")
  })

  // Ties are broken by pane id so the result is deterministic and testable.
  test("breaks a perfect tie deterministically", () => {
    //  pz  |  pa   (stacked on the right, both equally adjacent to pz)
    //      |  pb
    const root = createGroup("root", "horizontal", [
      createPane("pz"),
      createGroup("right", "vertical", [createPane("pb"), createPane("pa")]),
    ])
    const first = findAdjacentPane(root, "pz", "right")
    expect(first).not.toBeNull()
    expect(first).toBe(findAdjacentPane(root, "pz", "right"))
    expect(["pa", "pb"]).toContain(first ?? "")
  })
})
