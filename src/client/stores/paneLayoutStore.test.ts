import { beforeEach, describe, expect, test } from "bun:test"
import { collectPanes, findPaneContainingTab } from "../lib/paneTree"
import { usePaneLayoutStore } from "./paneLayoutStore"

const P = "proj-1"
const s = () => usePaneLayoutStore.getState()

function reset() {
  usePaneLayoutStore.setState({ layouts: {}, nodeSequence: 0 })
}

describe("paneLayoutStore", () => {
  beforeEach(reset)

  test("hands out a default chat layout for an unseen project", () => {
    const layout = s().getLayout(P)
    expect(collectPanes(layout.root)).toHaveLength(1)
    expect(layout.root.kind).toBe("pane")
  })

  test("the default layout is not persisted until something changes it", () => {
    s().getLayout(P)
    expect(s().layouts[P]).toBeUndefined()
  })

  test("openTab adds a tab and focuses it", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const layout = s().getLayout(P)
    expect(findPaneContainingTab(layout.root, "terminal_2_t1")).not.toBeNull()
  })

  // The singleton rule, enforced by the id derivation rather than by a check here.
  test("opening chat twice does not create a second chat tab", () => {
    s().openTab(P, { kind: "chat" })
    s().openTab(P, { kind: "chat" })
    const tabs = collectPanes(s().getLayout(P).root).flatMap((pane) => pane.tabs)
    expect(tabs.filter((tab) => tab.target.kind === "chat")).toHaveLength(1)
  })

  test("splitting generates distinct node ids without a global counter collision", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    s().openTab(P, { kind: "terminal", terminalId: "t2" })
    const paneId = collectPanes(s().getLayout(P).root)[0]!.id
    s().splitPane(P, { tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })

    const panes = collectPanes(s().getLayout(P).root)
    expect(panes).toHaveLength(2)
    expect(new Set(panes.map((pane) => pane.id)).size).toBe(2)
  })

  test("closeTab removes it", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    s().closeTab(P, "terminal_2_t1")
    expect(findPaneContainingTab(s().getLayout(P).root, "terminal_2_t1")).toBeNull()
  })

  // Operations return null when nothing changes; the store must translate that
  // into an untouched state object so subscribers do not re-render.
  test("a no-op action preserves state identity", () => {
    s().openTab(P, { kind: "chat" })
    const before = s().layouts
    s().closeTab(P, "does-not-exist")
    expect(s().layouts).toBe(before)
    s().focusPane(P, "ghost-pane")
    expect(s().layouts).toBe(before)
  })

  test("projects are isolated", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const other = s().getLayout("proj-2")
    expect(collectPanes(other.root).flatMap((pane) => pane.tabs)).toHaveLength(0)
  })

  test("clearProject drops only that project", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    s().openTab("proj-2", { kind: "terminal", terminalId: "t2" })
    s().clearProject(P)
    expect(s().layouts[P]).toBeUndefined()
    expect(s().layouts["proj-2"]).toBeDefined()
  })

  test("seedFromLegacy installs a layout only when the project has none", () => {
    s().seedFromLegacy(P, {
      terminals: [{ id: "t1" }],
      mainSizes: [70, 30],
      terminalSizes: [100],
      changesVisible: false,
      changesSizePercent: 33,
    })
    const seeded = s().getLayout(P)
    expect(collectPanes(seeded.root)).toHaveLength(2)

    s().seedFromLegacy(P, {
      terminals: [],
      mainSizes: [68, 32],
      terminalSizes: [],
      changesVisible: true,
      changesSizePercent: 33,
    })
    // Unchanged: an existing layout is never overwritten by the seed.
    expect(collectPanes(s().getLayout(P).root)).toHaveLength(2)
  })

  test("focusTab moves focus to the tab's pane", () => {
    s().openTab(P, { kind: "chat" })
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const paneId = collectPanes(s().getLayout(P).root)[0]!.id
    s().splitPane(P, { tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })
    s().focusTab(P, "chat")
    expect(s().getLayout(P).focusedPaneId).toBe(paneId)
  })

  test("resizeGroup adjusts one boundary", () => {
    // Two tabs: splitting a pane's ONLY tab is refused, since it would strand
    // an empty pane.
    s().openTab(P, { kind: "chat" })
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const paneId = collectPanes(s().getLayout(P).root)[0]!.id
    s().splitPane(P, { tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })

    const root = s().getLayout(P).root
    expect(root.kind).toBe("group")
    if (root.kind !== "group") return
    s().resizeGroup(P, root.id, 0, 0.15)

    const after = s().getLayout(P).root
    if (after.kind !== "group") return
    expect(after.sizes[0]).toBeCloseTo(0.65, 6)
  })
})

describe("paneLayoutStore keyboard commands", () => {
  beforeEach(reset)

  /** A left/right split with the left pane focused. */
  function twoPanes() {
    // The pane needs a tab to keep; splitting its only tab is refused.
    s().openTab(P, { kind: "chat" })
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const layout = s().getLayout(P)
    const paneId = collectPanes(layout.root)[0].id
    s().splitPane(P, { tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })
    return collectPanes(s().getLayout(P).root)
  }

  test("focusAdjacentPane moves focus geometrically", () => {
    const [left, right] = twoPanes()
    s().focusPane(P, left.id)

    s().focusAdjacentPane(P, "right")
    expect(s().getLayout(P).focusedPaneId).toBe(right.id)

    s().focusAdjacentPane(P, "left")
    expect(s().getLayout(P).focusedPaneId).toBe(left.id)
  })

  test("focusAdjacentPane is a no-op when there is no pane that way", () => {
    const [left] = twoPanes()
    s().focusPane(P, left.id)
    const before = s().getLayout(P)

    s().focusAdjacentPane(P, "up")

    expect(s().getLayout(P)).toBe(before)
  })

  test("cycleFocusedPaneTab wraps in both directions", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    s().openTab(P, { kind: "terminal", terminalId: "t2" })
    const pane = collectPanes(s().getLayout(P).root)[0]
    const ids = pane.tabs.map((tab) => tab.tabId)
    expect(ids.length).toBeGreaterThan(1)

    s().focusTab(P, ids[0])
    s().cycleFocusedPaneTab(P, -1)
    // Stepping back from the first tab lands on the last.
    expect(collectPanes(s().getLayout(P).root)[0].focusedTabId).toBe(ids[ids.length - 1])

    s().cycleFocusedPaneTab(P, 1)
    expect(collectPanes(s().getLayout(P).root)[0].focusedTabId).toBe(ids[0])
  })

  test("closeFocusedTab closes the focused pane's active tab", () => {
    s().openTab(P, { kind: "terminal", terminalId: "t1" })
    const before = collectPanes(s().getLayout(P).root)[0]
    const target = before.focusedTabId

    s().closeFocusedTab(P)

    expect(findPaneContainingTab(s().getLayout(P).root, target!)).toBeNull()
  })

  test("splitFocusedPane splits around the focused pane's active tab", () => {
    s().openTab(P, { kind: "chat" })
    s().openTab(P, { kind: "terminal", terminalId: "t1" })

    s().splitFocusedPane(P, "right")

    expect(collectPanes(s().getLayout(P).root)).toHaveLength(2)
  })

  test("the keyboard commands ignore a project with nothing focused", () => {
    const layout = s().getLayout(P)
    expect(layout.focusedPaneId).not.toBeNull()

    // No crash, no throw, on an untouched project.
    s().focusAdjacentPane(P, "down")
    s().cycleFocusedPaneTab(P, 1)
    s().splitFocusedPane(P, "bottom")
    expect(collectPanes(s().getLayout(P).root).length).toBeGreaterThanOrEqual(1)
  })
})
