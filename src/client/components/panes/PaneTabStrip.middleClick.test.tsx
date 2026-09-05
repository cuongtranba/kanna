import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { TooltipProvider } from "../ui/tooltip"
import { PaneTabStrip } from "./PaneTabStrip"


const chat = createTab({ kind: "chat", chatId: "c1" }, 0)
const terminal = createTab({ kind: "terminal", terminalId: "t1" }, 1)

interface Harness {
  closed: string[]
  selected: string[]
}

async function mount(pane: PaneLeaf) {
  const closed: string[] = []
  const selected: string[] = []
  const rendered = await renderClientMarkup(
    <TooltipProvider>
      <PaneTabStrip
        pane={pane}
        isPaneFocused
        width={800}
        presentation={{ terminalTitles: { t1: "Terminal A" } }}
        onSelectTab={(tabId) => selected.push(tabId)}
        onCloseTab={(tabId) => closed.push(tabId)}
        onSplit={() => undefined}
      />
    </TooltipProvider>,
  )
  const harness: Harness = { closed, selected }
  return { ...rendered, harness }
}

function tabElement(container: HTMLElement, tabId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`)
  if (!element) throw new Error(`no tab rendered for ${tabId}`)
  return element
}

async function middleClick(element: HTMLElement) {
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 })
  const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })
  await act(async () => {
    element.dispatchEvent(down)
    element.dispatchEvent(aux)
  })
  return { down }
}

describe("PaneTabStrip middle-click", () => {
  test("closes the tab under the wheel", async () => {
    const { container, harness, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    await middleClick(tabElement(container, terminal.tabId))
    await cleanup()

    expect(harness.closed).toEqual([terminal.tabId])
  })

  test("does not select the tab it closes", async () => {
    const { container, harness, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    await middleClick(tabElement(container, terminal.tabId))
    await cleanup()

    expect(harness.selected).toEqual([])
  })

  test("suppresses the browser's autoscroll on the press", async () => {
    const { container, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    const { down } = await middleClick(tabElement(container, chat.tabId))
    await cleanup()

    expect(down.defaultPrevented).toBe(true)
  })

  test("a left click still selects and never closes", async () => {
    const { container, harness, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    await act(async () => {
      tabElement(container, terminal.tabId).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      )
    })
    await cleanup()

    expect(harness.selected).toEqual([terminal.tabId])
    expect(harness.closed).toEqual([])
  })

  test("a right click leaves the tab alone", async () => {
    const { container, harness, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    await act(async () => {
      tabElement(container, terminal.tabId).dispatchEvent(
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }),
      )
    })
    await cleanup()

    expect(harness.closed).toEqual([])
  })
})
