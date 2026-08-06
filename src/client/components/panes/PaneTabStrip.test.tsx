import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TooltipProvider } from "../ui/tooltip"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { PaneTabStrip } from "./PaneTabStrip"

const chat = createTab({ kind: "chat", chatId: "c1" }, 0)
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
    expect(html).toContain(`data-tab-id="${chat.tabId}"`)
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

  // A chat tab became closable when it stopped being the only one; with N open
  // chats the user needs a way to close the one they are done with.
  test("every tab offers a close affordance", () => {
    const html = render(createPane("p", [chat, t1]))
    expect(html).toContain("Close Chat")
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

describe("PaneTabStrip split availability", () => {
  test("marks the split actions unavailable when the pane has one tab", () => {
    // The engine refuses this split (it would strand an empty pane), so the
    // button must not offer it. Found by driving the real app in a browser:
    // the split produced a pane with no tabs, no content, and no close button.
    const html = render(createPane("p1", [chat]))

    expect(html).toContain('aria-label="Split right"')
    expect(html).toContain('aria-disabled="true"')
  })

  test("offers the split once a second tab exists", () => {
    const html = render(createPane("p1", [chat, t1]))

    expect(html).toContain('aria-label="Split right"')
    expect(html).not.toContain('aria-disabled="true"')
  })
})
