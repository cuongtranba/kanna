import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { TooltipProvider } from "../ui/tooltip"
import { PaneTabStrip } from "./PaneTabStrip"

/**
 * Middle-click closes a tab, the way it does in every browser and editor.
 *
 * These assertions need a real DOM rather than the static markup the rest of
 * the strip's tests read: the behaviour lives entirely in a React synthetic
 * handler, and the one thing worth proving is that the `auxclick` a wheel press
 * actually emits reaches it — while the `click` a left press emits still
 * selects rather than closes.
 */

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

/** What a wheel press emits: a mousedown, then `auxclick` — never `click`. */
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

  // The close is the whole gesture: a middle press must not also drag the tab
  // into the pane's focus on its way out.
  test("does not select the tab it closes", async () => {
    const { container, harness, cleanup } = await mount(createPane("p", [chat, terminal], chat.tabId))

    await middleClick(tabElement(container, terminal.tabId))
    await cleanup()

    expect(harness.selected).toEqual([])
  })

  // A middle press on a scrollable region arms the browser's autoscroll, and
  // the strip scrolls. Closing a tab must not leave the user panning.
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

  // A right-click carries the same `auxclick` as the wheel does; only button 1
  // may close, or every context menu would take a tab with it.
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
