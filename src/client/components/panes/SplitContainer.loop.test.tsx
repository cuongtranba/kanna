import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { createDefaultLayout, createGroup, createPane, createTab, type PaneLayout } from "../../lib/paneTree"
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
    usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
    const store = usePaneLayoutStore.getState()
    store.openTab({ kind: "chat", chatId: "c1" })

    const { loopWarnings, thrown, cleanup } = await renderForLoopCheck(
      <SplitContainer
        layout={store.getLayout()}
        renderPane={(pane) => <div>{pane.id}</div>}
        onFocusPane={(paneId) => store.focusPane(paneId)}
        onResizeGroup={(groupId, sizes) => store.setGroupSizes(groupId, sizes)}
      />,
    )
    await cleanup()
    expect(thrown).toBeNull()
    expect(loopWarnings).toEqual([])
  })
})
