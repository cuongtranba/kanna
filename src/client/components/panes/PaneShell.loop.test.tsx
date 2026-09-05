import { describe, expect, test } from "bun:test"
import { createPane, createTab } from "../../lib/paneTree"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { TooltipProvider } from "../ui/tooltip"
import { PaneShell } from "./PaneShell"
import type { PaneContentRegistry } from "./paneContentRegistry"
import type { TabPresentationContext } from "./tabPresentation"

const registry: PaneContentRegistry = {
  chat: () => <div>chat</div>,
  board: () => null,
  changes: () => <div>changes</div>,
  terminal: (target) => <div>{target.terminalId}</div>,
}

const presentation: TabPresentationContext = { terminalTitles: {} }

describe("PaneShell render loop", () => {
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
