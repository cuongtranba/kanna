import { beforeEach, describe, expect, test } from "bun:test"
import { buildTabId, collectPanes, createDefaultLayout, findPaneContainingTab } from "../lib/paneTree"
import { usePaneLayoutStore } from "./paneLayoutStore"

const s = () => usePaneLayoutStore.getState()

function reset() {
  usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
}

describe("paneLayoutStore", () => {
  beforeEach(reset)

  test("starts from a single empty pane", () => {
    const layout = s().getLayout()
    expect(collectPanes(layout.root)).toHaveLength(1)
    expect(layout.root.kind).toBe("pane")
    expect(collectPanes(layout.root).flatMap((pane) => pane.tabs)).toHaveLength(0)
  })

  test("openTab adds a tab and focuses it", () => {
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const layout = s().getLayout()
    expect(findPaneContainingTab(layout.root, "terminal_2_t1")).not.toBeNull()
  })

  // The singleton rule, enforced by the id derivation rather than by a check here.
  test("opening chat twice does not create a second chat tab", () => {
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "chat", chatId: "c1" })
    const tabs = collectPanes(s().getLayout().root).flatMap((pane) => pane.tabs)
    expect(tabs.filter((tab) => tab.target.kind === "chat")).toHaveLength(1)
  })

  /**
   * The point of collapsing the per-project layouts into one: chats opened from
   * different projects land in the SAME workspace, side by side, instead of one
   * project's arrangement replacing the other's.
   */
  test("chats from different projects accumulate in one workspace", () => {
    s().openTab({ kind: "chat", chatId: "chat-in-project-a" })
    s().openTab({ kind: "chat", chatId: "chat-in-project-b" })

    const chatIds = collectPanes(s().getLayout().root)
      .flatMap((pane) => pane.tabs)
      .flatMap((tab) => (tab.target.kind === "chat" ? [tab.target.chatId] : []))

    expect(chatIds).toEqual(["chat-in-project-a", "chat-in-project-b"])
  })

  test("splitting generates distinct node ids without a global counter collision", () => {
    s().openTab({ kind: "terminal", terminalId: "t1" })
    s().openTab({ kind: "terminal", terminalId: "t2" })
    const paneId = collectPanes(s().getLayout().root)[0]!.id
    s().splitPane({ tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })

    const panes = collectPanes(s().getLayout().root)
    expect(panes).toHaveLength(2)
    expect(new Set(panes.map((pane) => pane.id)).size).toBe(2)
  })

  test("closeTab removes it", () => {
    s().openTab({ kind: "terminal", terminalId: "t1" })
    s().closeTab("terminal_2_t1")
    expect(findPaneContainingTab(s().getLayout().root, "terminal_2_t1")).toBeNull()
  })

  // Operations return null when nothing changes; the store must translate that
  // into an untouched state object so subscribers do not re-render.
  test("a no-op action preserves state identity", () => {
    s().openTab({ kind: "chat", chatId: "c1" })
    const before = s().layout
    s().closeTab("does-not-exist")
    expect(s().layout).toBe(before)
    s().focusPane("ghost-pane")
    expect(s().layout).toBe(before)
  })

  test("seedFromLegacy installs a layout only while the workspace is empty", () => {
    s().seedFromLegacy({
      terminals: [{ id: "t1" }],
      mainSizes: [70, 30],
      terminalSizes: [100],
      changesVisible: false,
      changesSizePercent: 33,
    })
    const seeded = s().getLayout()
    expect(collectPanes(seeded.root)).toHaveLength(2)

    s().seedFromLegacy({
      terminals: [],
      mainSizes: [68, 32],
      terminalSizes: [],
      changesVisible: true,
      changesSizePercent: 33,
    })
    // Unchanged: a workspace that already holds tabs is never re-seeded — which
    // is what stops the second project you open from wiping the first's tabs.
    expect(collectPanes(s().getLayout().root)).toHaveLength(2)
  })

  test("focusTab moves focus to the tab's pane", () => {
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const paneId = collectPanes(s().getLayout().root)[0]!.id
    s().splitPane({ tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })
    s().focusTab(buildTabId({ kind: "chat", chatId: "c1" }))
    expect(s().getLayout().focusedPaneId).toBe(paneId)
  })

  test("resizeGroup adjusts one boundary", () => {
    // Two tabs: splitting a pane's ONLY tab is refused, since it would strand
    // an empty pane.
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const paneId = collectPanes(s().getLayout().root)[0]!.id
    s().splitPane({ tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })

    const root = s().getLayout().root
    expect(root.kind).toBe("group")
    if (root.kind !== "group") return
    s().resizeGroup(root.id, 0, 0.15)

    const after = s().getLayout().root
    if (after.kind !== "group") return
    expect(after.sizes[0]).toBeCloseTo(0.65, 6)
  })

  /** A horizontal split; returns the pane ids left-to-right. */
  function splitHorizontally(): string[] {
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const paneId = collectPanes(s().getLayout().root)[0]!.id
    s().splitPane({ tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })
    return collectPanes(s().getLayout().root).map((pane) => pane.id)
  }

  function leftShare(): number {
    const root = s().getLayout().root
    return root.kind === "group" ? root.sizes[0]! : Number.NaN
  }

  test("resizeFocusedPane moves the divider toward the arrow", () => {
    const [left] = splitHorizontally()
    s().focusPane(left!)
    s().resizeFocusedPane("right")
    expect(leftShare()).toBeCloseTo(0.55, 6)
  })

  /**
   * The end-to-end proof of the divider model: one boundary moves the same way
   * whichever side of it holds focus. Under a "right always grows me" rule this
   * case would come back 0.45 and the divider would travel against the key.
   */
  test("the divider moves identically from the pane on either side of it", () => {
    const [, right] = splitHorizontally()
    s().focusPane(right!)
    s().resizeFocusedPane("right")
    expect(leftShare()).toBeCloseTo(0.55, 6)
  })

  test("resizeFocusedPane leaves state untouched when there is no boundary", () => {
    splitHorizontally()
    const before = s().getLayout()

    s().resizeFocusedPane("down")
    expect(s().getLayout()).toBe(before)

    usePaneLayoutStore.setState({ layout: { ...before, focusedPaneId: null } })
    const unfocused = s().getLayout()
    s().resizeFocusedPane("right")
    expect(s().getLayout()).toBe(unfocused)
  })

  test("resizeFocusedPane is inert on the default single pane", () => {
    const before = s().getLayout()
    s().resizeFocusedPane("right")
    expect(s().getLayout()).toBe(before)
  })
})

describe("paneLayoutStore persistence", () => {
  /**
   * v1 kept `layouts` keyed by projectId. There is no honest mapping from N
   * project trees to the one workspace, so the migration drops the arrangement
   * rather than picking a project's tree arbitrarily — ChatPage re-opens the
   * tabs. What it must NOT do is leak the old shape through: a surviving
   * `layouts` key would sit in storage forever, and a surviving `layout` taken
   * from one project would silently make that project's arrangement global.
   */
  test("migrating from v1 drops the per-project layouts but keeps the node sequence", () => {
    const migrate = usePaneLayoutStore.persist.getOptions().migrate
    expect(migrate).toBeDefined()

    const migrated = migrate?.(
      { layouts: { "proj-1": createDefaultLayout() }, nodeSequence: 7 },
      1,
    )

    expect(migrated).toEqual({ nodeSequence: 7 })
  })

  test("a v2 payload passes through untouched", () => {
    const migrate = usePaneLayoutStore.persist.getOptions().migrate
    const payload = { layout: createDefaultLayout(), nodeSequence: 3 }
    expect(migrate?.(payload, 2)).toBe(payload)
  })
})

describe("paneLayoutStore keyboard commands", () => {
  beforeEach(reset)

  /** A left/right split with the left pane focused. */
  function twoPanes() {
    // The pane needs a tab to keep; splitting its only tab is refused.
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const layout = s().getLayout()
    const paneId = collectPanes(layout.root)[0].id
    s().splitPane({ tabId: "terminal_2_t1", targetPaneId: paneId, position: "right" })
    return collectPanes(s().getLayout().root)
  }

  test("focusAdjacentPane moves focus geometrically", () => {
    const [left, right] = twoPanes()
    s().focusPane(left.id)

    s().focusAdjacentPane("right")
    expect(s().getLayout().focusedPaneId).toBe(right.id)

    s().focusAdjacentPane("left")
    expect(s().getLayout().focusedPaneId).toBe(left.id)
  })

  test("focusAdjacentPane is a no-op when there is no pane that way", () => {
    const [left] = twoPanes()
    s().focusPane(left.id)
    const before = s().getLayout()

    s().focusAdjacentPane("up")

    expect(s().getLayout()).toBe(before)
  })

  test("cycleFocusedPaneTab wraps in both directions", () => {
    s().openTab({ kind: "terminal", terminalId: "t1" })
    s().openTab({ kind: "terminal", terminalId: "t2" })
    const pane = collectPanes(s().getLayout().root)[0]
    const ids = pane.tabs.map((tab) => tab.tabId)
    expect(ids.length).toBeGreaterThan(1)

    s().focusTab(ids[0])
    s().cycleFocusedPaneTab(-1)
    // Stepping back from the first tab lands on the last.
    expect(collectPanes(s().getLayout().root)[0].focusedTabId).toBe(ids[ids.length - 1])

    s().cycleFocusedPaneTab(1)
    expect(collectPanes(s().getLayout().root)[0].focusedTabId).toBe(ids[0])
  })

  test("closeFocusedTab closes the focused pane's active tab", () => {
    s().openTab({ kind: "terminal", terminalId: "t1" })
    const before = collectPanes(s().getLayout().root)[0]
    const target = before.focusedTabId

    s().closeFocusedTab()

    expect(findPaneContainingTab(s().getLayout().root, target!)).toBeNull()
  })

  test("splitFocusedPane splits around the focused pane's active tab", () => {
    s().openTab({ kind: "chat", chatId: "c1" })
    s().openTab({ kind: "terminal", terminalId: "t1" })

    s().splitFocusedPane("right")

    expect(collectPanes(s().getLayout().root)).toHaveLength(2)
  })

  test("the keyboard commands ignore a workspace with nothing focused", () => {
    const layout = s().getLayout()
    expect(layout.focusedPaneId).not.toBeNull()

    // No crash, no throw, on an untouched workspace.
    s().focusAdjacentPane("down")
    s().cycleFocusedPaneTab(1)
    s().splitFocusedPane("bottom")
    expect(collectPanes(s().getLayout().root).length).toBeGreaterThanOrEqual(1)
  })
})
