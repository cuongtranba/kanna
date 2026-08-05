import { afterEach, describe, expect, test } from "bun:test"
import { createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { usePaneDragStore } from "../../stores/paneDragStore"
import { SplitContainer } from "./SplitContainer"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)

const split: PaneLayout = {
  root: createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createPane("pb", [term("b")]),
  ]),
  focusedPaneId: "pa",
}

function render() {
  return renderClientMarkup(
    <SplitContainer
      layout={split}
      renderPane={(pane) => <div data-testid={`content-${pane.id}`} />}
      onFocusPane={() => undefined}
      onResizeGroup={() => undefined}
    />,
  )
}

afterEach(() => {
  usePaneDragStore.getState().endDrag()
})

describe("SplitContainer drop indicator", () => {
  test("shows nothing when no drag is in progress", async () => {
    const { html, cleanup } = await render()
    await cleanup()

    expect(html).not.toContain("data-pane-drop")
  })

  test("outlines the whole pane for a merge", async () => {
    usePaneDragStore.getState().beginDrag(term("a").tabId)
    usePaneDragStore.getState().hoverPane("pb", { kind: "merge" })

    const { html, cleanup } = await render()
    await cleanup()

    expect(html).toContain('data-pane-drop="merge"')
  })

  test("shows a half-pane band on the side being split toward", async () => {
    usePaneDragStore.getState().beginDrag(term("a").tabId)
    usePaneDragStore.getState().hoverPane("pb", { kind: "split", position: "right" })

    const { html, cleanup } = await render()
    await cleanup()

    expect(html).toContain('data-pane-drop="split-right"')
    expect(html).toContain("w-1/2")
  })

  test("marks the indicator only on the pane being hovered", async () => {
    usePaneDragStore.getState().beginDrag(term("a").tabId)
    usePaneDragStore.getState().hoverPane("pb", { kind: "merge" })

    const { html, cleanup } = await render()
    await cleanup()

    expect(html.split("data-pane-drop").length - 1).toBe(1)
  })

  test("the indicator never swallows pointer events", async () => {
    // A drop target that captured the pointer would cancel the drag it previews.
    usePaneDragStore.getState().beginDrag(term("a").tabId)
    usePaneDragStore.getState().hoverPane("pa", { kind: "merge" })

    const { html, cleanup } = await render()
    await cleanup()

    expect(html).toContain("pointer-events-none")
  })
})

describe("paneDragStore", () => {
  test("an unchanged hover does not publish a new snapshot", () => {
    // A drag fires move events continuously; a fresh snapshot per pixel would
    // re-render every pane in the tree for the duration of the drag.
    usePaneDragStore.getState().hoverPane("pa", { kind: "split", position: "left" })
    const before = usePaneDragStore.getState()

    usePaneDragStore.getState().hoverPane("pa", { kind: "split", position: "left" })

    expect(usePaneDragStore.getState()).toBe(before)
  })

  test("a changed edge does publish", () => {
    usePaneDragStore.getState().hoverPane("pa", { kind: "split", position: "left" })
    const before = usePaneDragStore.getState()

    usePaneDragStore.getState().hoverPane("pa", { kind: "split", position: "right" })

    expect(usePaneDragStore.getState()).not.toBe(before)
  })

  test("endDrag clears everything", () => {
    usePaneDragStore.getState().beginDrag("t")
    usePaneDragStore.getState().hoverPane("pa", { kind: "merge" })

    usePaneDragStore.getState().endDrag()

    expect(usePaneDragStore.getState().activeTabId).toBeNull()
    expect(usePaneDragStore.getState().overPaneId).toBeNull()
    expect(usePaneDragStore.getState().intent).toBeNull()
  })
})
