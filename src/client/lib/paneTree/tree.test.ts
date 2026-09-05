import { describe, expect, test } from "bun:test"
import {
  collectPanes,
  createDefaultLayout,
  createGroup,
  createPane,
  createTab,
  detachTab,
  findNearestSiblingPaneId,
  findPanePath,
  findPaneContainingTab,
  getNodeAtPath,
  getTreeDepth,
  insertTabIntoPane,
  removePaneByPath,
  replaceNodeAtPath,
} from "./tree"
import { DEFAULT_PANE_ID, type PaneNode } from "./types"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)
const chat = () => createTab({ kind: "chat", chatId: "c1" }, 0)

function twoPanes(): PaneNode {
  return createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createPane("pb", [term("b")]),
  ])
}

describe("createPane", () => {
  test("focuses the first tab by default and null when empty", () => {
    expect(createPane("p", [term("a"), term("b")]).focusedTabId).toBe(term("a").tabId)
    expect(createPane("p", []).focusedTabId).toBeNull()
  })

  test("coerces a focus id that is not in the pane", () => {
    expect(createPane("p", [term("a")], "nope").focusedTabId).toBe(term("a").tabId)
  })

  test("drops duplicate tab ids", () => {
    expect(createPane("p", [term("a"), term("a")]).tabs).toHaveLength(1)
  })
})

describe("createGroup", () => {
  test("normalizes sizes to sum 1", () => {
    const group = createGroup("g", "horizontal", [createPane("a"), createPane("b")], [3, 1])
    expect(group.kind).toBe("group")
    if (group.kind !== "group") return
    expect(group.sizes).toEqual([0.75, 0.25])
  })

  test("collapses to the child when given only one", () => {
    const only = createPane("solo")
    expect(createGroup("g", "horizontal", [only])).toBe(only)
  })

  test("collapses an empty child list to an empty pane rather than an empty group", () => {
    const node = createGroup("g", "horizontal", [])
    expect(node.kind).toBe("pane")
  })
})

describe("createDefaultLayout", () => {
  test("is one focused pane with the default id", () => {
    const layout = createDefaultLayout()
    expect(layout.root.kind).toBe("pane")
    expect(layout.root.id).toBe(DEFAULT_PANE_ID)
    expect(layout.focusedPaneId).toBe(DEFAULT_PANE_ID)
  })
})

describe("getTreeDepth", () => {
  test("counts a pane as 1 and a group as one more than its deepest child", () => {
    expect(getTreeDepth(createPane("p"))).toBe(1)
    expect(getTreeDepth(twoPanes())).toBe(2)
    const nested = createGroup("g0", "vertical", [twoPanes(), createPane("pc")])
    expect(getTreeDepth(nested)).toBe(3)
  })
})

describe("findPanePath / getNodeAtPath", () => {
  test("locates a pane by child-index path and round-trips", () => {
    const root = twoPanes()
    expect(findPanePath(root, "pa")).toEqual([0])
    expect(findPanePath(root, "pb")).toEqual([1])
    expect(getNodeAtPath(root, [1])?.id).toBe("pb")
  })

  test("returns an empty path when the root itself is the pane", () => {
    expect(findPanePath(createPane("only"), "only")).toEqual([])
  })

  test("returns null for an unknown pane and an invalid path", () => {
    expect(findPanePath(twoPanes(), "nope")).toBeNull()
    expect(getNodeAtPath(twoPanes(), [9])).toBeNull()
  })
})

describe("findPaneContainingTab", () => {
  test("finds the pane holding a tab", () => {
    const root = twoPanes()
    expect(findPaneContainingTab(root, term("b").tabId)?.pane.id).toBe("pb")
    expect(findPaneContainingTab(root, "missing")).toBeNull()
  })
})

describe("collectPanes", () => {
  test("returns panes in left-to-right document order", () => {
    const root = createGroup("g0", "vertical", [twoPanes(), createPane("pc")])
    expect(collectPanes(root).map((pane) => pane.id)).toEqual(["pa", "pb", "pc"])
  })
})

describe("replaceNodeAtPath", () => {
  test("rebuilds ancestors so sizes stay normalized", () => {
    const root = twoPanes()
    const next = replaceNodeAtPath(root, [0], createPane("replaced"))
    expect(next.kind).toBe("group")
    if (next.kind !== "group") return
    expect(next.children[0]?.id).toBe("replaced")
    expect(next.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  test("an empty path replaces the root outright", () => {
    expect(replaceNodeAtPath(twoPanes(), [], createPane("x")).id).toBe("x")
  })
})

describe("removePaneByPath", () => {
  test("removing the root pane yields an empty pane with the same id", () => {
    const root = createPane("only", [term("a")])
    const next = removePaneByPath(root, [])
    expect(next.kind).toBe("pane")
    expect(next.id).toBe("only")
    if (next.kind !== "pane") return
    expect(next.tabs).toEqual([])
  })

  test("removing one of two siblings collapses the group to the survivor", () => {
    const next = removePaneByPath(twoPanes(), [0])
    expect(next.kind).toBe("pane")
    expect(next.id).toBe("pb")
  })

  test("removing one of three siblings keeps the group and renormalizes", () => {
    const root = createGroup("g", "horizontal", [
      createPane("pa"),
      createPane("pb"),
      createPane("pc"),
    ])
    const next = removePaneByPath(root, [1])
    expect(next.kind).toBe("group")
    if (next.kind !== "group") return
    expect(next.children.map((child) => child.id)).toEqual(["pa", "pc"])
    expect(next.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  test("collapse cascades when an inner split reduces to one child", () => {
    const root = createGroup("outer", "vertical", [twoPanes(), createPane("pc")])
    const next = removePaneByPath(root, [0, 0])
    expect(next.kind).toBe("group")
    if (next.kind !== "group") return
    expect(next.children.map((child) => child.id)).toEqual(["pb", "pc"])
    expect(getTreeDepth(next)).toBe(2)
  })
})

describe("detachTab", () => {
  test("removes the tab and reports where it came from", () => {
    const result = detachTab(twoPanes(), term("a").tabId)
    expect(result.tab?.tabId).toBe(term("a").tabId)
    expect(result.sourcePaneId).toBe("pa")
  })

  test("collapses the source pane when it empties", () => {
    const result = detachTab(twoPanes(), term("a").tabId)
    expect(result.root.kind).toBe("pane")
    expect(result.root.id).toBe("pb")
  })

  test("preserveEmptyPaneId keeps an emptied pane alive", () => {
    const result = detachTab(twoPanes(), term("a").tabId, { preserveEmptyPaneId: "pa" })
    expect(result.root.kind).toBe("group")
    const pane = findPaneContainingTab(result.root, term("b").tabId)
    expect(pane?.pane.id).toBe("pb")
    expect(getNodeAtPath(result.root, [0])?.id).toBe("pa")
  })

  test("keeps the pane and repoints focus when other tabs remain", () => {
    const root = createPane("p", [term("a"), term("b")], term("a").tabId)
    const result = detachTab(root, term("a").tabId)
    expect(result.root.kind).toBe("pane")
    if (result.root.kind !== "pane") return
    expect(result.root.tabs).toHaveLength(1)
    expect(result.root.focusedTabId).toBe(term("b").tabId)
  })

  test("is a no-op for an unknown tab", () => {
    const root = twoPanes()
    const result = detachTab(root, "missing")
    expect(result.root).toBe(root)
    expect(result.tab).toBeNull()
  })
})

describe("insertTabIntoPane", () => {
  test("appends and focuses by default", () => {
    const root = insertTabIntoPane(createPane("p", [term("a")]), "p", term("z"))
    expect(root).not.toBeNull()
    if (!root || root.kind !== "pane") return
    expect(root.tabs.map((tab) => tab.tabId)).toEqual([term("a").tabId, term("z").tabId])
    expect(root.focusedTabId).toBe(term("z").tabId)
  })

  test("inserts at an explicit index", () => {
    const root = insertTabIntoPane(createPane("p", [term("a"), term("b")]), "p", term("z"), {
      index: 1,
    })
    if (!root || root.kind !== "pane") return
    expect(root.tabs.map((tab) => tab.tabId)).toEqual([
      term("a").tabId,
      term("z").tabId,
      term("b").tabId,
    ])
  })

  test("can insert without stealing focus", () => {
    const root = insertTabIntoPane(createPane("p", [term("a")]), "p", chat(), { focus: false })
    if (!root || root.kind !== "pane") return
    expect(root.focusedTabId).toBe(term("a").tabId)
  })

  test("returns null for an unknown pane rather than throwing", () => {
    expect(insertTabIntoPane(createPane("p"), "nope", term("z"))).toBeNull()
  })
})

describe("findNearestSiblingPaneId", () => {
  test("prefers the last pane of the left sibling", () => {
    const root = createGroup("g", "horizontal", [twoPanes(), createPane("pc")])
    expect(findNearestSiblingPaneId(root, "pc")).toBe("pb")
  })

  test("falls back to the first pane of the right sibling", () => {
    const root = createGroup("g", "horizontal", [createPane("pc"), twoPanes()])
    expect(findNearestSiblingPaneId(root, "pc")).toBe("pa")
  })

  test("returns null when the pane is the only one", () => {
    expect(findNearestSiblingPaneId(createPane("only"), "only")).toBeNull()
  })
})
