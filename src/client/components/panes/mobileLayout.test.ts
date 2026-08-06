import { describe, expect, test } from "bun:test"
import { createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
import { flattenLayoutForMobile } from "./mobileLayout"

const chat = createTab({ kind: "chat", chatId: "c1" }, 0)
const changes = createTab({ kind: "changes" }, 0)
const t1 = createTab({ kind: "terminal", terminalId: "t1" }, 0)
const t2 = createTab({ kind: "terminal", terminalId: "t2" }, 0)

describe("flattenLayoutForMobile", () => {
  test("passes a single pane through unchanged", () => {
    const layout: PaneLayout = { root: createPane("p1", [chat]), focusedPaneId: "p1" }

    expect(flattenLayoutForMobile(layout)).toEqual(createPane("p1", [chat]))
  })

  test("gathers tabs from every pane so none is unreachable on a narrow screen", () => {
    // A layout split on desktop then opened on a phone must not strand the tabs
    // that live in the panes we are not rendering.
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [chat]),
        createPane("pb", [changes, t1]),
      ]),
      focusedPaneId: "pa",
    }

    const flat = flattenLayoutForMobile(layout)

    expect(flat.tabs.map((tab) => tab.tabId)).toEqual([chat.tabId, changes.tabId, t1.tabId])
  })

  test("keeps tabs in tree order, depth first", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [chat]),
        createGroup("g2", "vertical", [createPane("pb", [t1]), createPane("pc", [t2])]),
      ]),
      focusedPaneId: "pc",
    }

    expect(flattenLayoutForMobile(layout).tabs.map((tab) => tab.tabId)).toEqual([
      chat.tabId,
      t1.tabId,
      t2.tabId,
    ])
  })

  test("adopts the focused pane's active tab", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [chat]),
        createPane("pb", [changes, t1]),
      ]),
      focusedPaneId: "pb",
    }

    // pb's own focus is its first tab, "changes" — that is what the phone shows.
    expect(flattenLayoutForMobile(layout).focusedTabId).toBe(changes.tabId)
  })

  test("takes the identity of the focused pane so split and scoping stay coherent", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [chat]),
        createPane("pb", [changes]),
      ]),
      focusedPaneId: "pb",
    }

    expect(flattenLayoutForMobile(layout).id).toBe("pb")
  })

  test("falls back to the first pane when nothing is focused", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [chat]),
        createPane("pb", [changes]),
      ]),
      focusedPaneId: null,
    }

    const flat = flattenLayoutForMobile(layout)

    expect(flat.id).toBe("pa")
    expect(flat.focusedTabId).toBe(chat.tabId)
  })

  test("falls back to the first tab when the focused pane is empty", () => {
    const layout: PaneLayout = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", []),
        createPane("pb", [changes]),
      ]),
      focusedPaneId: "pa",
    }

    expect(flattenLayoutForMobile(layout).focusedTabId).toBe(changes.tabId)
  })

  test("survives a layout whose focused pane id does not exist", () => {
    const layout: PaneLayout = { root: createPane("p1", [chat]), focusedPaneId: "ghost" }

    const flat = flattenLayoutForMobile(layout)

    expect(flat.id).toBe("p1")
    expect(flat.focusedTabId).toBe(chat.tabId)
  })

  test("yields an empty pane for an empty layout rather than throwing", () => {
    const layout: PaneLayout = { root: createPane("p1", []), focusedPaneId: "p1" }

    const flat = flattenLayoutForMobile(layout)

    expect(flat.tabs).toEqual([])
    expect(flat.focusedTabId).toBeNull()
  })
})
