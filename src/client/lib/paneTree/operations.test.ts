import { describe, expect, test } from "bun:test"
import {
  closeTab,
  focusPane,
  focusTab,
  moveTabToPane,
  openTab,
  reorderPaneTabs,
  resizeGroup,
  splitPane,
} from "./operations"
import { collectPanes, createGroup, createPane, createTab, findPaneContainingTab, getTreeDepth } from "./tree"
import { DEFAULT_PANE_ID, MAX_TREE_DEPTH, type PaneLayout } from "./types"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)
const TA = term("a").tabId
const TB = term("b").tabId
const TC = term("c").tabId

function ids(n: string) {
  return { paneId: `pane-${n}`, groupId: `group-${n}` }
}

/** One pane holding tabs a, b, c. */
function singlePane(): PaneLayout {
  return {
    root: createPane("p1", [term("a"), term("b"), term("c")], TA),
    focusedPaneId: "p1",
  }
}

function twoPaneLayout(): PaneLayout {
  return {
    root: createGroup("g1", "horizontal", [
      createPane("pa", [term("a")]),
      createPane("pb", [term("b")]),
    ]),
    focusedPaneId: "pa",
  }
}

describe("splitPane", () => {
  test("moves the tab into a new sibling pane", () => {
    const next = splitPane(singlePane(), {
      tabId: TB,
      targetPaneId: "p1",
      position: "right",
      ids: ids("1"),
    })
    expect(next).not.toBeNull()
    if (!next) return
    expect(next.root.kind).toBe("group")
    expect(collectPanes(next.root).map((pane) => pane.id)).toEqual(["p1", "pane-1"])
    expect(findPaneContainingTab(next.root, TB)?.pane.id).toBe("pane-1")
    expect(next.focusedPaneId).toBe("pane-1")
  })

  test("position decides direction and side", () => {
    const right = splitPane(singlePane(), {
      tabId: TB, targetPaneId: "p1", position: "right", ids: ids("r"),
    })
    const left = splitPane(singlePane(), {
      tabId: TB, targetPaneId: "p1", position: "left", ids: ids("l"),
    })
    const bottom = splitPane(singlePane(), {
      tabId: TB, targetPaneId: "p1", position: "bottom", ids: ids("d"),
    })
    expect(right?.root.kind === "group" && right.root.direction).toBe("horizontal")
    expect(bottom?.root.kind === "group" && bottom.root.direction).toBe("vertical")
    expect(collectPanes(right!.root).map((p) => p.id)).toEqual(["p1", "pane-r"])
    expect(collectPanes(left!.root).map((p) => p.id)).toEqual(["pane-l", "p1"])
  })

  // Without flattening, three "split right" operations would nest three levels
  // deep and the resize handles would become unusable.
  test("splitting the same direction repeatedly stays flat", () => {
    let layout: PaneLayout | null = {
      root: createPane("p1", [term("a"), term("b"), term("c")], TA),
      focusedPaneId: "p1",
    }
    layout = splitPane(layout!, { tabId: TB, targetPaneId: "p1", position: "right", ids: ids("1") })
    layout = splitPane(layout!, { tabId: TC, targetPaneId: "pane-1", position: "right", ids: ids("2") })
    expect(layout).not.toBeNull()
    if (!layout) return
    expect(getTreeDepth(layout.root)).toBe(2)
    expect(layout.root.kind).toBe("group")
    if (layout.root.kind !== "group") return
    expect(layout.root.children).toHaveLength(3)
    expect(layout.root.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  test("splitting the opposite direction nests", () => {
    let layout = splitPane(singlePane(), {
      tabId: TB, targetPaneId: "p1", position: "right", ids: ids("1"),
    })
    layout = splitPane(layout!, {
      tabId: TC, targetPaneId: "pane-1", position: "bottom", ids: ids("2"),
    })
    expect(getTreeDepth(layout!.root)).toBe(3)
  })

  // Splitting out a pane's LAST tab must not delete the pane being split.
  test("splitting the only tab of a pane keeps the source pane alive and empty", () => {
    const layout: PaneLayout = {
      root: createPane("p1", [term("a")], TA),
      focusedPaneId: "p1",
    }
    const next = splitPane(layout, {
      tabId: TA, targetPaneId: "p1", position: "right", ids: ids("1"),
    })
    expect(next).not.toBeNull()
    if (!next) return
    const panes = collectPanes(next.root)
    expect(panes.map((pane) => pane.id)).toEqual(["p1", "pane-1"])
    expect(panes[0]?.tabs).toEqual([])
  })

  test("rejects a split that would exceed the depth cap", () => {
    // Explicitly at the cap: v[ pane, h[ pane, v[ pane, pane ] ] ].
    const layout: PaneLayout = {
      root: createGroup("outer", "vertical", [
        createPane("pA", [term("a")]),
        createGroup("mid", "horizontal", [
          createPane("pB", [term("b")]),
          createGroup("inner", "vertical", [
            // Two tabs, so detaching one cannot collapse the pane and make room.
            createPane("pC", [term("c"), createTab({ kind: "chat" }, 0)], TC),
            createPane("pD", [createTab({ kind: "changes" }, 0)]),
          ]),
        ]),
      ]),
      focusedPaneId: "pC",
    }
    expect(getTreeDepth(layout.root)).toBe(MAX_TREE_DEPTH)

    // pC's parent is vertical, so a horizontal split must nest — depth 5.
    expect(
      splitPane(layout, { tabId: TC, targetPaneId: "pC", position: "right", ids: ids("x") }),
    ).toBeNull()

    // A same-direction split stays flat and is still allowed at the cap.
    expect(
      splitPane(layout, { tabId: TC, targetPaneId: "pC", position: "bottom", ids: ids("y") }),
    ).not.toBeNull()
  })

  // A split that empties its source pane collapses it, which can free a level —
  // so the cap is measured on the real candidate tree, never predicted.
  test("a collapsing source pane can make room for an otherwise-too-deep split", () => {
    const layout: PaneLayout = {
      root: createGroup("outer", "vertical", [
        createPane("pA", [term("a")]),
        createGroup("mid", "horizontal", [
          createPane("pB", [term("b")]),
          createGroup("inner", "vertical", [
            createPane("pC", [term("c")]),
            createPane("pD", [createTab({ kind: "chat" }, 0)]),
          ]),
        ]),
      ]),
      focusedPaneId: "pC",
    }
    expect(getTreeDepth(layout.root)).toBe(MAX_TREE_DEPTH)

    // pC holds only this tab, so the detach collapses pC and the inner group,
    // leaving room for the new pane.
    const next = splitPane(layout, {
      tabId: TC, targetPaneId: "pD", position: "right", ids: ids("z"),
    })
    expect(next).not.toBeNull()
    expect(getTreeDepth(next!.root)).toBeLessThanOrEqual(MAX_TREE_DEPTH)
  })

  test("returns null for an unknown tab or pane", () => {
    expect(splitPane(singlePane(), { tabId: "nope", targetPaneId: "p1", position: "right", ids: ids("1") })).toBeNull()
    expect(splitPane(singlePane(), { tabId: TA, targetPaneId: "nope", position: "right", ids: ids("1") })).toBeNull()
  })
})

describe("closeTab", () => {
  test("focus moves to the tab on the right", () => {
    const next = closeTab(singlePane(), TB)
    expect(next).not.toBeNull()
    if (!next || next.root.kind !== "pane") return
    expect(next.root.tabs.map((tab) => tab.tabId)).toEqual([TA, TC])
  })

  test("closing the focused tab picks the right neighbour, then the left", () => {
    const focusedB: PaneLayout = {
      root: createPane("p1", [term("a"), term("b"), term("c")], TB),
      focusedPaneId: "p1",
    }
    const afterB = closeTab(focusedB, TB)
    expect(afterB?.root.kind === "pane" && afterB.root.focusedTabId).toBe(TC)

    const focusedC: PaneLayout = {
      root: createPane("p1", [term("a"), term("b"), term("c")], TC),
      focusedPaneId: "p1",
    }
    const afterC = closeTab(focusedC, TC)
    expect(afterC?.root.kind === "pane" && afterC.root.focusedTabId).toBe(TB)
  })

  test("closing a background tab does not move focus", () => {
    const next = closeTab(singlePane(), TC)
    expect(next?.root.kind === "pane" && next.root.focusedTabId).toBe(TA)
  })

  // The tree must always offer somewhere to render.
  test("closing the last tab of the last pane leaves one empty focused pane", () => {
    const layout: PaneLayout = { root: createPane("p1", [term("a")], TA), focusedPaneId: "p1" }
    const next = closeTab(layout, TA)
    expect(next).not.toBeNull()
    if (!next || next.root.kind !== "pane") return
    expect(next.root.tabs).toEqual([])
    expect(next.focusedPaneId).toBe("p1")
  })

  test("closing the last tab of a pane collapses it and moves focus to a sibling", () => {
    const next = closeTab(twoPaneLayout(), TA)
    expect(next).not.toBeNull()
    if (!next) return
    expect(next.root.kind).toBe("pane")
    expect(next.root.id).toBe("pb")
    expect(next.focusedPaneId).toBe("pb")
  })

  test("returns null for an unknown tab", () => {
    expect(closeTab(singlePane(), "nope")).toBeNull()
  })
})

describe("moveTabToPane", () => {
  test("moves across panes and follows focus", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [term("a"), term("b")], TA),
        createPane("pb", [term("c")]),
      ]),
      focusedPaneId: "pa",
    }
    const next = moveTabToPane(layout, TB, "pb")
    expect(next).not.toBeNull()
    if (!next) return
    expect(findPaneContainingTab(next.root, TB)?.pane.id).toBe("pb")
    expect(next.focusedPaneId).toBe("pb")
  })

  test("collapses the source pane when the move empties it", () => {
    const next = moveTabToPane(twoPaneLayout(), TA, "pb")
    expect(next?.root.kind).toBe("pane")
    expect(next?.root.id).toBe("pb")
  })

  test("returns null for an unknown tab or destination", () => {
    expect(moveTabToPane(twoPaneLayout(), "nope", "pb")).toBeNull()
    expect(moveTabToPane(twoPaneLayout(), TA, "nope")).toBeNull()
  })
})

describe("focusTab / focusPane", () => {
  test("focusing a tab focuses its pane too", () => {
    const next = focusTab(twoPaneLayout(), TB)
    expect(next).not.toBeNull()
    if (!next) return
    expect(next.focusedPaneId).toBe("pb")
  })

  // Returning null on a no-op lets the store keep referential identity and skip
  // a re-render.
  test("focusing what is already focused is a no-op", () => {
    expect(focusTab(twoPaneLayout(), TA)).toBeNull()
    expect(focusPane(twoPaneLayout(), "pa")).toBeNull()
  })

  test("focusPane does not change which tab is active in that pane", () => {
    const next = focusPane(twoPaneLayout(), "pb")
    const pane = collectPanes(next!.root).find((candidate) => candidate.id === "pb")
    expect(pane?.focusedTabId).toBe(TB)
  })

  test("returns null for unknown targets", () => {
    expect(focusTab(twoPaneLayout(), "nope")).toBeNull()
    expect(focusPane(twoPaneLayout(), "nope")).toBeNull()
  })
})

describe("reorderPaneTabs", () => {
  test("applies an explicit order", () => {
    const next = reorderPaneTabs(singlePane(), "p1", [TC, TA, TB])
    expect(next?.root.kind === "pane" && next.root.tabs.map((t) => t.tabId)).toEqual([TC, TA, TB])
  })

  // A partial order is safe: unmentioned tabs keep their relative order at the end.
  test("appends tabs the caller did not mention", () => {
    const next = reorderPaneTabs(singlePane(), "p1", [TC])
    expect(next?.root.kind === "pane" && next.root.tabs.map((t) => t.tabId)).toEqual([TC, TA, TB])
  })

  test("ignores unknown ids", () => {
    const next = reorderPaneTabs(singlePane(), "p1", ["ghost", TC])
    expect(next?.root.kind === "pane" && next.root.tabs.map((t) => t.tabId)).toEqual([TC, TA, TB])
  })

  test("returns null for an unknown pane or a no-op order", () => {
    expect(reorderPaneTabs(singlePane(), "nope", [TA])).toBeNull()
    expect(reorderPaneTabs(singlePane(), "p1", [TA, TB, TC])).toBeNull()
  })
})

describe("openTab", () => {
  test("adds a tab to the focused pane and focuses it", () => {
    const layout: PaneLayout = { root: createPane("p1", []), focusedPaneId: "p1" }
    const result = openTab(layout, { kind: "chat" }, { createdAt: 5 })
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.tabId).toBe("chat")
    expect(result.layout.root.kind === "pane" && result.layout.root.focusedTabId).toBe("chat")
  })

  // Because the id is derived from the target, "open" is idempotent — a second
  // chat tab is impossible by construction, which is how the singleton rule holds.
  test("reopening an existing target focuses it instead of duplicating", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [term("a")]),
        createPane("pb", [createTab({ kind: "chat" }, 0)]),
      ]),
      focusedPaneId: "pa",
    }
    const result = openTab(layout, { kind: "chat" }, { createdAt: 9 })
    expect(result).not.toBeNull()
    if (!result) return
    expect(collectPanes(result.layout.root).flatMap((p) => p.tabs)).toHaveLength(2)
    expect(result.layout.focusedPaneId).toBe("pb")
  })

  test("can open without stealing focus", () => {
    const layout: PaneLayout = { root: createPane("p1", [term("a")], TA), focusedPaneId: "p1" }
    const result = openTab(layout, { kind: "chat" }, { createdAt: 5, focus: false })
    expect(result?.layout.root.kind === "pane" && result.layout.root.focusedTabId).toBe(TA)
  })

  test("falls back to the first pane when nothing is focused", () => {
    const layout: PaneLayout = { ...twoPaneLayout(), focusedPaneId: null }
    const result = openTab(layout, { kind: "chat" }, { createdAt: 5 })
    expect(findPaneContainingTab(result!.layout.root, "chat")?.pane.id).toBe("pa")
  })
})

describe("resizeGroup", () => {
  test("moves one boundary and preserves the total", () => {
    const next = resizeGroup(twoPaneLayout(), "g1", 0, 0.2)
    expect(next).not.toBeNull()
    if (!next || next.root.kind !== "group") return
    expect(next.root.sizes[0]).toBeCloseTo(0.7, 10)
    expect(next.root.sizes[1]).toBeCloseTo(0.3, 10)
  })

  test("returns null for an unknown group or a zero delta", () => {
    expect(resizeGroup(twoPaneLayout(), "nope", 0, 0.2)).toBeNull()
    expect(resizeGroup(twoPaneLayout(), "g1", 0, 0)).toBeNull()
  })
})

describe("default pane id", () => {
  test("is stable so a fresh layout is recognisable", () => {
    expect(DEFAULT_PANE_ID).toBe("main")
  })
})
