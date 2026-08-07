import { afterEach, describe, expect, test } from "bun:test"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useViewportStore } from "../../stores/viewportStore"
import { TooltipProvider } from "../ui/tooltip"
import { PaneTabStrip } from "./PaneTabStrip"

const PHONE_WIDTH = 390

// Six tabs on a 390px strip is the case that used to collapse to icon-only.
const tabs = Array.from({ length: 6 }, (_, index) =>
  createTab({ kind: "terminal", terminalId: `t${index}` }, index),
)

function render(pane: PaneLeaf, width = PHONE_WIDTH) {
  return renderClientMarkup(
    <TooltipProvider>
      <PaneTabStrip
        pane={pane}
        isPaneFocused
        width={width}
        presentation={{ terminalTitles: { t5: "Terminal F" } }}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onSplit={() => undefined}
      />
    </TooltipProvider>,
  )
}

afterEach(() => {
  useViewportStore.setState({ width: 0, height: 0 })
})

describe("PaneTabStrip on a phone", () => {
  test("gives the horizontal gesture to the browser instead of the drag sensor", async () => {
    // touch-action intersects down the ancestor chain, so touch-none on a tab
    // freezes the whole strip: the finger can never pan the scroll container.
    useViewportStore.setState({ width: PHONE_WIDTH, height: 844 })

    const { html, cleanup } = await render(createPane("p", tabs))
    await cleanup()

    expect(html).toContain("touch-pan-x")
    expect(html).not.toContain("touch-none")
  })

  test("scrolls smoothly rather than shrinking every tab to an icon", async () => {
    useViewportStore.setState({ width: PHONE_WIDTH, height: 844 })

    const { html, cleanup } = await render(createPane("p", tabs))
    await cleanup()

    expect(html).toContain("overflow-x-auto")
    expect(html).toContain("motion-safe:scroll-smooth")
    expect(html).toContain("overscroll-x-contain")
    // Labels survive: every tab here carries the same icon, so the label is the
    // only thing that tells them apart.
    expect(html).toContain("Terminal F")
  })

  test("claims the swipe so scrolling back does not open the sidebar", async () => {
    useViewportStore.setState({ width: PHONE_WIDTH, height: 844 })

    const { html, cleanup } = await render(createPane("p", tabs))
    await cleanup()

    expect(html).toContain("data-swipe-scroll-x")
  })

  test("leaves the swipe to the sidebar when the strip has nothing to scroll", async () => {
    useViewportStore.setState({ width: PHONE_WIDTH, height: 844 })

    const { html, cleanup } = await render(createPane("p", tabs.slice(0, 2)))
    await cleanup()

    expect(html).not.toContain("data-swipe-scroll-x")
  })

  test("keeps the drag sensor on a pointer viewport", async () => {
    useViewportStore.setState({ width: 1200, height: 900 })

    const { html, cleanup } = await render(createPane("p", tabs), 1200)
    await cleanup()

    expect(html).toContain("touch-none")
    expect(html).not.toContain("touch-pan-x")
  })

  test("treats an unmeasured viewport as a pointer one", async () => {
    // Width 0 means "unmeasured", not "narrow" — first paint must not flash the
    // phone behaviour before the resize subscription reports a real width.
    useViewportStore.setState({ width: 0, height: 0 })

    const { html, cleanup } = await render(createPane("p", tabs), 800)
    await cleanup()

    expect(html).toContain("touch-none")
  })
})
