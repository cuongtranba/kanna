import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
import { SplitContainer } from "./SplitContainer"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)

function renderLayout(layout: PaneLayout) {
  return renderToStaticMarkup(
    <SplitContainer
      layout={layout}
      renderPane={(pane) => <div data-testid={`content-${pane.id}`} />}
      onFocusPane={() => undefined}
      onResizeGroup={() => undefined}
    />,
  )
}

const single: PaneLayout = {
  root: createPane("p1", [term("a")]),
  focusedPaneId: "p1",
}

const split: PaneLayout = {
  root: createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createPane("pb", [term("b")]),
  ]),
  focusedPaneId: "pa",
}

const nested: PaneLayout = {
  root: createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createGroup("g2", "vertical", [createPane("pb", [term("b")]), createPane("pc", [term("c")])]),
  ]),
  focusedPaneId: "pa",
}

describe("SplitContainer", () => {
  test("renders a lone pane without a resize handle", () => {
    const html = renderLayout(single)
    expect(html).toContain("content-p1")
    expect(html).not.toContain("data-separator")
  })

  test("renders each pane's content exactly once", () => {
    const html = renderLayout(nested)
    for (const id of ["pa", "pb", "pc"]) {
      expect(html.split(`content-${id}`).length - 1).toBe(1)
    }
  })

  test("puts a separator between siblings but not after the last", () => {
    expect(renderLayout(split).split("data-separator").length - 1).toBe(1)
  })

  test("nests groups, one separator per boundary", () => {
    // g1 has one boundary, g2 has one boundary.
    expect(renderLayout(nested).split("data-separator").length - 1).toBe(2)
  })

  test("marks the focused pane so the tab strip can tint its indicator", () => {
    const html = renderLayout(split)
    expect(html).toContain('data-pane-focused="true"')
    expect(html).toContain('data-pane-focused="false"')
  })

  test("stamps each pane with its id for hit-testing and drop zones", () => {
    const html = renderLayout(nested)
    for (const id of ["pa", "pb", "pc"]) {
      expect(html).toContain(`data-pane-id="${id}"`)
    }
  })

  test("renders an empty pane rather than collapsing it away", () => {
    const html = renderLayout({ root: createPane("empty", []), focusedPaneId: "empty" })
    expect(html).toContain("content-empty")
  })

  // Sizes are not asserted here: react-resizable-panels resolves defaultSize at
  // runtime, so static markup carries flex-grow rather than the percentage.
  // The size arithmetic is covered by the engine and store suites.
  test("lays a horizontal group out as a row and a vertical one as a column", () => {
    expect(renderLayout(split)).toContain("flex-direction:row")

    const vertical: PaneLayout = {
      root: createGroup("g1", "vertical", [createPane("pa"), createPane("pb")]),
      focusedPaneId: "pa",
    }
    expect(renderLayout(vertical)).toContain("flex-direction:column")
  })

  // ARIA orientation is deliberately the inverse of the split direction: a
  // horizontal split is divided by a vertically-oriented separator.
  test("gives the separator the inverse aria-orientation", () => {
    expect(renderLayout(split)).toContain('aria-orientation="vertical"')
  })

  test("gives every panel the node id, so a split cannot remount a sibling", () => {
    const html = renderLayout(nested)
    for (const id of ["pa", "pb", "pc"]) {
      expect(html).toContain(`data-panel="true" data-testid="${id}" id="${id}"`)
    }
  })
})
