import { describe, expect, test } from "bun:test"
import { createPane, createTab } from "../../lib/paneTree"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { TooltipProvider } from "../ui/tooltip"
import { PaneShell } from "./PaneShell"
import type { PaneContentRegistry } from "./paneContentRegistry"
import type { TabPresentationContext } from "./tabPresentation"

const registry: PaneContentRegistry = {
  chat: () => <div>chat</div>,
  changes: () => <div>changes</div>,
  terminal: (target) => <div>{target.terminalId}</div>,
}

const presentation: TabPresentationContext = { terminalTitles: {} }

describe("PaneShell render loop", () => {
  // The shell notes each activation into the pane-scoped store from an effect
  // and derives the retained set from that same store. A recency write that did
  // not settle — or a selector returning a fresh array — would loop (React #185).
  test("mounts and records activation without a render loop", async () => {
    const pane = createPane("p1", [
      createTab({ kind: "chat", chatId: "c1" }, 0),
      createTab({ kind: "terminal", terminalId: "t1" }, 0),
    ])

    const { loopWarnings, thrown, cleanup } = await renderForLoopCheck(
      <TooltipProvider>
        <PaneShell
          pane={pane}
          isFocused
          registry={registry}
          presentation={presentation}
          onSelectTab={() => undefined}
          onCloseTab={() => undefined}
          onSplit={() => undefined}
        />
      </TooltipProvider>,
    )

    await cleanup()
    expect(thrown).toBeNull()
    expect(loopWarnings).toEqual([])
  })
})
