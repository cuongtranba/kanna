import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { TooltipProvider } from "../ui/tooltip"
import { PaneShell } from "./PaneShell"
import type { PaneContentRegistry } from "./paneContentRegistry"
import type { TabPresentationContext } from "./tabPresentation"

const registry: PaneContentRegistry = {
  chat: () => <div data-testid="content-chat" />,
  board: () => null,
  changes: () => <div data-testid="content-changes" />,
  terminal: (target) => <div data-testid={`content-terminal-${target.terminalId}`} />,
}

const presentation: TabPresentationContext = { terminalTitles: {} }

function renderShell(pane: PaneLeaf) {
  return renderToStaticMarkup(
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
}

const chatTab = createTab({ kind: "chat", chatId: "c1" }, 0)
const changesTab = createTab({ kind: "changes" }, 0)
const termTab = createTab({ kind: "terminal", terminalId: "t1" }, 0)

describe("PaneShell retention", () => {
  test("keeps a backgrounded tab mounted instead of unmounting it", () => {
    const pane = createPane("p1", [chatTab, termTab])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    // The terminal is not the active tab, but its subtree is still in the DOM —
    // unmounting it would destroy the PTY scrollback.
    expect(html).toContain("content-chat")
    expect(html).toContain("content-terminal-t1")
  })

  test("hides backgrounded tabs with visibility, never display:none", () => {
    // display:none collapses the layout box, which discards scroll offsets and
    // makes xterm remeasure to zero. visibility:hidden keeps the box.
    const pane = createPane("p1", [chatTab, termTab])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    expect(html).toContain("invisible")
    expect(html).not.toContain("display:none")
    // Not the Tailwind `hidden` utility either — it is display:none by another
    // name. (Substring-matching `hidden` alone would hit `overflow-hidden` and
    // the icons' `aria-hidden`, so match the class-list boundary.)
    expect(html).not.toContain("min-w-0 hidden")
  })

  test("marks backgrounded tabs inert so they leave the focus order", () => {
    const pane = createPane("p1", [chatTab, termTab])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    expect(html).toContain("inert")
  })

  test("does not mark the active tab inert or invisible", () => {
    const pane = createPane("p1", [chatTab])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    expect(html).toContain("content-chat")
    expect(html).not.toContain("inert")
    expect(html).not.toContain("invisible")
  })

  test("renders an empty pane without content", () => {
    const pane = createPane("p1", [])
    const html = renderShell(pane)

    expect(html).not.toContain("content-")
  })

  test("retains every terminal tab in a pane", () => {
    const t2 = createTab({ kind: "terminal", terminalId: "t2" }, 0)
    const t3 = createTab({ kind: "terminal", terminalId: "t3" }, 0)
    const pane = createPane("p1", [chatTab, termTab, t2, t3])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    expect(html).toContain("content-terminal-t1")
    expect(html).toContain("content-terminal-t2")
    expect(html).toContain("content-terminal-t3")
  })

  test("renders retained tabs in tab order regardless of which is active", () => {
    const pane = createPane("p1", [chatTab, changesTab])
    const html = renderShell({ ...pane, focusedTabId: changesTab.tabId })

    expect(html.indexOf("content-chat")).toBeLessThan(html.indexOf("content-changes"))
  })
})

describe("PaneShell content sizing", () => {
  test("stacks tab content in a column so it fills the pane width", () => {
    // Regression: the wrapper was a row flex, which sizes each child to its
    // CONTENT width — the chat card rendered 24px wide inside a 1117px pane.
    // Only the terminal escaped, because it happens to carry flex-1.
    const pane = createPane("p1", [chatTab])
    const html = renderShell({ ...pane, focusedTabId: chatTab.tabId })

    expect(html).toContain("absolute inset-0 flex min-h-0 min-w-0 flex-col")
  })
})
