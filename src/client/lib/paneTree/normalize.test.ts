import { describe, expect, test } from "bun:test"
import { normalizeLayout } from "./normalize"
import { buildTabId } from "./tabTarget"
import { collectPanes, createGroup, createPane, createTab, getTreeDepth } from "./tree"
import { DEFAULT_PANE_ID } from "./types"
import type { JsonValue } from "../../../shared/json"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)

const CHAT_C1_TAB_ID = buildTabId({ kind: "chat", chatId: "c1" })

describe("normalizeLayout", () => {
  test("returns a default layout for anything unusable", () => {
    const unusable: (JsonValue | undefined)[] = [null, undefined, 42, "layout", {}, { root: null }, []]
    for (const value of unusable) {
      const layout = normalizeLayout(value)
      expect(layout.root.kind).toBe("pane")
      expect(layout.root.id).toBe(DEFAULT_PANE_ID)
      expect(layout.focusedPaneId).toBe(DEFAULT_PANE_ID)
    }
  })

  test("round-trips a valid layout", () => {
    const original = {
      root: createGroup("g1", "horizontal", [
        createPane("pa", [term("a")]),
        createPane("pb", [term("b")]),
      ]),
      focusedPaneId: "pb",
    }
    const layout = normalizeLayout(JSON.parse(JSON.stringify(original)))
    expect(collectPanes(layout.root).map((pane) => pane.id)).toEqual(["pa", "pb"])
    expect(layout.focusedPaneId).toBe("pb")
  })

  test("drops tabs whose target is no longer valid", () => {
    const layout = normalizeLayout({
      root: {
        kind: "pane",
        id: "p1",
        tabs: [
          { tabId: "chat", target: { kind: "chat", chatId: "c1" }, createdAt: 0 },
          { tabId: "junk", target: { kind: "terminal", terminalId: "" }, createdAt: 0 },
          { tabId: "alien", target: { kind: "nope" }, createdAt: 0 },
        ],
        focusedTabId: "chat",
      },
      focusedPaneId: "p1",
    })
    expect(collectPanes(layout.root)[0]?.tabs.map((tab) => tab.tabId)).toEqual([CHAT_C1_TAB_ID])
  })

  test("re-derives the tab id from its target", () => {
    const layout = normalizeLayout({
      root: {
        kind: "pane",
        id: "p1",
        tabs: [{ tabId: "wrong-id", target: { kind: "chat", chatId: "c1" }, createdAt: 0 }],
        focusedTabId: "wrong-id",
      },
      focusedPaneId: "p1",
    })
    const pane = collectPanes(layout.root)[0]
    expect(pane?.tabs[0]?.tabId).toBe(CHAT_C1_TAB_ID)
    expect(pane?.focusedTabId).toBe(CHAT_C1_TAB_ID)
  })

  test("dedupes a target that somehow appears twice", () => {
    const layout = normalizeLayout({
      root: {
        kind: "pane",
        id: "p1",
        tabs: [
          { tabId: "chat", target: { kind: "chat", chatId: "c1" }, createdAt: 0 },
          { tabId: "chat", target: { kind: "chat", chatId: "c1" }, createdAt: 1 },
        ],
        focusedTabId: "chat",
      },
      focusedPaneId: "p1",
    })
    expect(collectPanes(layout.root)[0]?.tabs).toHaveLength(1)
  })

  test("collapses a single-child group and drops an empty one", () => {
    const single = normalizeLayout({
      root: { kind: "group", id: "g", direction: "horizontal", children: [
        { kind: "pane", id: "solo", tabs: [], focusedTabId: null },
      ], sizes: [1] },
      focusedPaneId: "solo",
    })
    expect(single.root.kind).toBe("pane")
    expect(single.root.id).toBe("solo")

    const empty = normalizeLayout({
      root: { kind: "group", id: "g", direction: "horizontal", children: [], sizes: [] },
      focusedPaneId: null,
    })
    expect(empty.root.kind).toBe("pane")
  })

  test("repairs sizes that do not match the child count or sum", () => {
    const layout = normalizeLayout({
      root: {
        kind: "group", id: "g", direction: "horizontal",
        children: [
          { kind: "pane", id: "pa", tabs: [], focusedTabId: null },
          { kind: "pane", id: "pb", tabs: [], focusedTabId: null },
        ],
        sizes: [99],
      },
      focusedPaneId: "pa",
    })
    expect(layout.root.kind).toBe("group")
    if (layout.root.kind !== "group") return
    expect(layout.root.sizes).toHaveLength(2)
    expect(layout.root.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  test("repoints a focused pane id that no longer exists", () => {
    const layout = normalizeLayout({
      root: { kind: "pane", id: "p1", tabs: [], focusedTabId: null },
      focusedPaneId: "ghost",
    })
    expect(layout.focusedPaneId).toBe("p1")
  })

  test("preserves a deliberate null focus", () => {
    const layout = normalizeLayout({
      root: { kind: "pane", id: "p1", tabs: [], focusedTabId: null },
      focusedPaneId: null,
    })
    expect(layout.focusedPaneId).toBeNull()
  })

  test("truncates a tree deeper than the cap rather than rejecting it", () => {
    const deep = normalizeLayout({
      root: {
        kind: "group", id: "g1", direction: "horizontal",
        children: [
          { kind: "pane", id: "pa", tabs: [], focusedTabId: null },
          { kind: "group", id: "g2", direction: "vertical", children: [
            { kind: "pane", id: "pb", tabs: [], focusedTabId: null },
            { kind: "group", id: "g3", direction: "horizontal", children: [
              { kind: "pane", id: "pc", tabs: [], focusedTabId: null },
              { kind: "group", id: "g4", direction: "vertical", children: [
                { kind: "pane", id: "pd", tabs: [], focusedTabId: null },
                { kind: "pane", id: "pe", tabs: [], focusedTabId: null },
              ], sizes: [0.5, 0.5] },
            ], sizes: [0.5, 0.5] },
          ], sizes: [0.5, 0.5] },
        ],
        sizes: [0.5, 0.5],
      },
      focusedPaneId: "pe",
    })
    expect(getTreeDepth(deep.root)).toBeLessThanOrEqual(4)
    expect(collectPanes(deep.root).length).toBeGreaterThan(0)
  })

  test("recovers missing ids deterministically", () => {
    const malformed = {
      root: {
        kind: "group", direction: "horizontal",
        children: [
          { kind: "pane", tabs: [], focusedTabId: null },
          { kind: "pane", tabs: [], focusedTabId: null },
        ],
        sizes: [0.5, 0.5],
      },
      focusedPaneId: null,
    }
    const first = normalizeLayout(structuredClone(malformed))
    const second = normalizeLayout(structuredClone(malformed))
    expect(collectPanes(first.root).map((pane) => pane.id)).toEqual(
      collectPanes(second.root).map((pane) => pane.id),
    )
    expect(new Set(collectPanes(first.root).map((pane) => pane.id)).size).toBe(2)
  })

  test("survives a cyclic-looking or absurdly malformed node", () => {
    const layout = normalizeLayout({
      root: { kind: "group", id: "g", direction: "sideways", children: "not-an-array", sizes: 3 },
      focusedPaneId: 7,
    })
    expect(layout.root.kind).toBe("pane")
    expect(collectPanes(layout.root)).toHaveLength(1)
  })
})
