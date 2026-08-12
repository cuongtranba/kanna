import { afterEach, describe, expect, test } from "bun:test"
import { createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useViewportStore } from "../../stores/viewportStore"
import { SplitContainer } from "./SplitContainer"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)

const split: PaneLayout = {
  root: createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createPane("pb", [term("b")]),
  ]),
  focusedPaneId: "pa",
}

function render(layout: PaneLayout) {
  return renderClientMarkup(
    <SplitContainer
      layout={layout}
      renderPane={(pane) => (
        <div data-testid={`content-${pane.id}`}>{pane.tabs.map((t) => t.tabId).join(",")}</div>
      )}
      onFocusPane={() => undefined}
      onResizeGroup={() => undefined}
    />,
  )
}

afterEach(() => {
  useViewportStore.setState({ width: 0, height: 0 })
})

describe("SplitContainer on a phone", () => {
  test("collapses a split into a single pane below the md breakpoint", async () => {
    useViewportStore.setState({ width: 500, height: 900 })

    const { html, cleanup } = await render(split)
    await cleanup()

    expect(html).toContain('data-pane-mobile="true"')
    expect(html).not.toContain("data-separator")
  })

  test("carries every tab into that pane so none becomes unreachable", async () => {
    useViewportStore.setState({ width: 500, height: 900 })

    const { html, cleanup } = await render(split)
    await cleanup()

    // Both terminals are addressable from the one strip.
    expect(html).toContain(`${term("a").tabId},${term("b").tabId}`)
  })

  test("renders the full tree at and above the md breakpoint", async () => {
    useViewportStore.setState({ width: 768, height: 900 })

    const { html, cleanup } = await render(split)
    await cleanup()

    expect(html).not.toContain('data-pane-mobile="true"')
    expect(html).toContain("content-pa")
    expect(html).toContain("content-pb")
  })

  /**
   * A tablet and a phone held sideways are both above the breakpoint, so they
   * already get real dividers — which is the whole of Kanna's touch resize
   * story. Pinning both widths means a future breakpoint change cannot quietly
   * take dividers away from those devices.
   */
  test("gives tablets and landscape phones a draggable divider", async () => {
    for (const width of [1024, 844]) {
      useViewportStore.setState({ width, height: 600 })

      const { html, cleanup } = await render(split)
      await cleanup()

      expect(html).not.toContain('data-pane-mobile="true"')
      expect(html).toContain("data-separator")
      expect(html).toContain("pointer-coarse:w-5")
    }
  })

  test("renders the tree when the viewport has not been measured yet", async () => {
    // Width 0 means "unmeasured", not "narrow" — first paint must not flash the
    // phone view before the resize subscription reports a real width.
    useViewportStore.setState({ width: 0, height: 0 })

    const { html, cleanup } = await render(split)
    await cleanup()

    expect(html).not.toContain('data-pane-mobile="true"')
  })
})
