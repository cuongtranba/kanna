import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TooltipProvider } from "../ui/tooltip"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { PaneTabStrip } from "./PaneTabStrip"

const chat = createTab({ kind: "chat" }, 0)
const changes = createTab({ kind: "changes" }, 0)
const t1 = createTab({ kind: "terminal", terminalId: "t1" }, 0)

function render(pane: PaneLeaf, isPaneFocused = true, width = 800) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PaneTabStrip
        pane={pane}
        isPaneFocused={isPaneFocused}
        width={width}
        presentation={{ terminalTitles: { t1: "Terminal A" } }}
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onSplit={() => undefined}
      />
    </TooltipProvider>,
  )
}

describe("PaneTabStrip", () => {
  test("renders one tab per tab in the pane", () => {
    const html = render(createPane("p", [chat, t1, changes]))
    expect(html).toContain('data-tab-id="chat"')
    expect(html).toContain('data-tab-id="changes"')
    expect(html).toContain(`data-tab-id="${t1.tabId}"`)
  })

  test("labels come from the target, not from stored state", () => {
    const html = render(createPane("p", [chat, t1]))
    expect(html).toContain("Chat")
    expect(html).toContain("Terminal A")
  })

  test("marks the active tab", () => {
    const html = render(createPane("p", [chat, t1], chat.tabId))
    expect(html).toContain('data-tab-active="true"')
    expect(html).toContain('data-tab-active="false"')
    expect(html).toContain('aria-selected="true"')
  })

  // The only pane-focus affordance is the tint of the active tab's top bar.
  test("tints the active tab indicator by pane focus", () => {
    expect(render(createPane("p", [chat]), true)).toContain('data-tab-indicator="focused"')
    expect(render(createPane("p", [chat]), false)).toContain('data-tab-indicator="unfocused"')
  })

  test("the indicator uses a token colour, never a literal", () => {
    const html = render(createPane("p", [chat]), true)
    expect(html).toContain("bg-destructive")
    expect(html).not.toContain("#")
  })

  test("chat cannot be closed but a terminal can", () => {
    const html = render(createPane("p", [chat, t1]))
    expect(html).not.toContain("Close Chat")
    expect(html).toContain("Close Terminal A")
  })

  test("offers both split directions", () => {
    const html = render(createPane("p", [chat]))
    expect(html).toContain("Split right")
    expect(html).toContain("Split down")
  })

  test("drops labels when the strip is too cramped for text", () => {
    const many = [chat, changes, t1]
    const html = render(createPane("p", many), true, 200)
    expect(html).not.toContain(">Chat<")
  })

  test("renders nothing but the actions for an empty pane", () => {
    const html = render(createPane("p", []))
    expect(html).not.toContain("data-tab-id")
    expect(html).toContain("Split right")
  })

  test("is a fixed-height row", () => {
    expect(render(createPane("p", [chat]))).toContain("height:36px")
  })
})
