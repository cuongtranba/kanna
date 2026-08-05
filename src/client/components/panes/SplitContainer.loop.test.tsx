import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { SplitContainer } from "./SplitContainer"

const term = (id: string) => createTab({ kind: "terminal", terminalId: id }, 0)

const nested: PaneLayout = {
  root: createGroup("g1", "horizontal", [
    createPane("pa", [term("a")]),
    createGroup("g2", "vertical", [createPane("pb", [term("b")]), createPane("pc", [term("c")])]),
  ]),
  focusedPaneId: "pa",
}

describe("SplitContainer render loop", () => {
  // The container wires a resize callback per group and a focus handler per
  // pane; an unstable identity there would re-run the library's layout effect
  // every render (React #185).
  test("mounts a nested tree without a render loop", async () => {
    const { loopWarnings, thrown, cleanup } = await renderForLoopCheck(
      <SplitContainer
        layout={nested}
        renderPane={(pane) => <div>{pane.id}</div>}
        onFocusPane={() => undefined}
        onResizeGroup={() => undefined}
      />,
    )
    await cleanup()
    expect(thrown).toBeNull()
    expect(loopWarnings).toEqual([])
  })

  test("mounts against the real store without a render loop", async () => {
    usePaneLayoutStore.setState({ layouts: {}, nodeSequence: 0 })
    const store = usePaneLayoutStore.getState()
    store.openTab("proj-loop", { kind: "chat" })

    const { loopWarnings, thrown, cleanup } = await renderForLoopCheck(
      <SplitContainer
        layout={store.getLayout("proj-loop")}
        renderPane={(pane) => <div>{pane.id}</div>}
        onFocusPane={(paneId) => store.focusPane("proj-loop", paneId)}
        onResizeGroup={(groupId, sizes) => store.setGroupSizes("proj-loop", groupId, sizes)}
      />,
    )
    await cleanup()
    expect(thrown).toBeNull()
    expect(loopWarnings).toEqual([])
  })
})
