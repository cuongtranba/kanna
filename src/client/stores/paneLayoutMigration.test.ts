import { describe, expect, test } from "bun:test"
import { collectPanes, getTreeDepth } from "../lib/paneTree"
import { MAX_TREE_DEPTH } from "../lib/paneTree"
import { buildLayoutFromLegacy, type LegacyProjectLayout } from "./paneLayoutMigration"

function legacy(overrides: Partial<LegacyProjectLayout> = {}): LegacyProjectLayout {
  return {
    terminals: [],
    mainSizes: [68, 32],
    terminalSizes: [],
    changesVisible: false,
    changesSizePercent: 33,
    ...overrides,
  }
}

function tabKinds(layout: ReturnType<typeof buildLayoutFromLegacy>) {
  return collectPanes(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.target.kind))
}

describe("buildLayoutFromLegacy", () => {
  test("a bare project becomes a single focused chat pane", () => {
    const layout = buildLayoutFromLegacy(legacy())
    expect(layout.root.kind).toBe("pane")
    expect(tabKinds(layout)).toEqual(["chat"])
    expect(layout.focusedPaneId).toBe(layout.root.id)
  })

  // Terminals were a horizontal strip beneath the chat; preserving that
  // arrangement means nobody loses the layout they had built.
  test("one terminal becomes a vertical split under the chat", () => {
    const layout = buildLayoutFromLegacy(legacy({ terminals: [{ id: "t1" }] }))
    expect(layout.root.kind).toBe("group")
    if (layout.root.kind !== "group") return
    expect(layout.root.direction).toBe("vertical")
    expect(tabKinds(layout)).toEqual(["chat", "terminal"])
  })

  test("the chat/terminal split keeps its stored proportions", () => {
    const layout = buildLayoutFromLegacy(legacy({ terminals: [{ id: "t1" }], mainSizes: [70, 30] }))
    if (layout.root.kind !== "group") return
    expect(layout.root.sizes[0]).toBeCloseTo(0.7, 6)
    expect(layout.root.sizes[1]).toBeCloseTo(0.3, 6)
  })

  test("several terminals stay side by side, one tab each", () => {
    const layout = buildLayoutFromLegacy(
      legacy({ terminals: [{ id: "t1" }, { id: "t2" }, { id: "t3" }], terminalSizes: [50, 25, 25] }),
    )
    const terminalPanes = collectPanes(layout.root).filter((pane) =>
      pane.tabs.some((tab) => tab.target.kind === "terminal"),
    )
    expect(terminalPanes).toHaveLength(3)
    for (const pane of terminalPanes) expect(pane.tabs).toHaveLength(1)
  })

  test("a visible changes panel becomes a pane on the right", () => {
    const layout = buildLayoutFromLegacy(legacy({ changesVisible: true, changesSizePercent: 30 }))
    expect(layout.root.kind).toBe("group")
    if (layout.root.kind !== "group") return
    expect(layout.root.direction).toBe("horizontal")
    expect(layout.root.sizes[1]).toBeCloseTo(0.3, 6)
    expect(tabKinds(layout)).toEqual(["chat", "changes"])
  })

  test("a hidden changes panel contributes no tab", () => {
    expect(tabKinds(buildLayoutFromLegacy(legacy({ changesVisible: false })))).toEqual(["chat"])
  })

  test("the fullest legacy layout still fits inside the depth cap", () => {
    const layout = buildLayoutFromLegacy(
      legacy({
        terminals: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
        terminalSizes: [40, 30, 30],
        changesVisible: true,
      }),
    )
    expect(getTreeDepth(layout.root)).toBeLessThanOrEqual(MAX_TREE_DEPTH)
    expect(tabKinds(layout).filter((kind) => kind === "terminal")).toHaveLength(3)
  })

  test("chat is always present and always focused", () => {
    for (const input of [
      legacy(),
      legacy({ terminals: [{ id: "t1" }] }),
      legacy({ changesVisible: true }),
      legacy({ terminals: [{ id: "t1" }], changesVisible: true }),
    ]) {
      const layout = buildLayoutFromLegacy(input)
      expect(tabKinds(layout)).toContain("chat")
      const focused = collectPanes(layout.root).find((pane) => pane.id === layout.focusedPaneId)
      expect(focused?.tabs.some((tab) => tab.target.kind === "chat")).toBe(true)
    }
  })

  // Legacy values came from localStorage and may be anything.
  test("survives nonsense sizes", () => {
    const layout = buildLayoutFromLegacy(
      legacy({
        terminals: [{ id: "t1" }, { id: "t2" }],
        mainSizes: [0, 0],
        terminalSizes: [Number.NaN, -4],
        changesVisible: true,
        changesSizePercent: 999,
      }),
    )
    const total = layout.root.kind === "group" ? layout.root.sizes.reduce((a, b) => a + b, 0) : 1
    expect(total).toBeCloseTo(1, 6)
    expect(tabKinds(layout).filter((kind) => kind === "terminal")).toHaveLength(2)
  })

  test("drops terminals with an unusable id rather than making a broken tab", () => {
    const layout = buildLayoutFromLegacy(legacy({ terminals: [{ id: "t1" }, { id: "  " }] }))
    expect(tabKinds(layout).filter((kind) => kind === "terminal")).toHaveLength(1)
  })

  test("gives every pane a distinct id", () => {
    const layout = buildLayoutFromLegacy(
      legacy({ terminals: [{ id: "t1" }, { id: "t2" }], changesVisible: true }),
    )
    const ids = collectPanes(layout.root).map((pane) => pane.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
