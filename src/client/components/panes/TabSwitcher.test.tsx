import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { useTabSwitcherHotkeys } from "../../hooks/useTabSwitcherHotkeys"
import { buildTabId, collectPanes, createDefaultLayout, type PaneTabTarget } from "../../lib/paneTree"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { useTabSwitcherStore } from "../../stores/tabSwitcherStore"
import { TabSwitcher } from "./TabSwitcher"

const CHATS = ["alpha", "beta", "gamma"] as const
const TITLES = { alpha: "Alpha", beta: "Beta", gamma: "Gamma" }
const PRESENTATION = { chatTitles: TITLES }

function Workspace() {
  const layout = usePaneLayoutStore((state) => state.layout)
  const focusTab = usePaneLayoutStore((state) => state.focusTab)
  useTabSwitcherHotkeys(null, true, focusTab)
  return <TabSwitcher layout={layout} presentation={PRESENTATION} keybindings={null} onCommit={focusTab} />
}

function chatTarget(chatId: string): PaneTabTarget {
  return { kind: "chat", chatId }
}

function focusedChat(): string | null {
  const layout = usePaneLayoutStore.getState().layout
  const pane = collectPanes(layout.root).find((candidate) => candidate.id === layout.focusedPaneId)
  const tab = pane?.tabs.find((candidate) => candidate.tabId === pane.focusedTabId)
  return tab?.target.kind === "chat" ? tab.target.chatId : null
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }))
  })
}

const tapSwitchKey = (init: KeyboardEventInit = {}, target: EventTarget = window) =>
  key("keydown", { key: "`", code: "Backquote", altKey: true, ...init }, target)
const releaseAlt = () => key("keyup", { key: "Alt", code: "AltLeft", altKey: false })

function optionLabels(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((node) => node.textContent ?? "")
}

function highlightedLabel(): string {
  return document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? ""
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layout: createDefaultLayout(), recentTabIds: [] })
  for (const chatId of CHATS) usePaneLayoutStore.getState().openTab(chatTarget(chatId))
})

afterEach(() => {
  useTabSwitcherStore.getState().closeSwitcher()
})

describe("recent-tab switcher", () => {
  test("tapping ⌥` and letting go of ⌥ returns to the tab used just before", async () => {
    const view = await renderClientMarkup(<Workspace />)
    try {
      tapSwitchKey()
      releaseAlt()
      expect(focusedChat()).toBe("beta")
    } finally {
      await view.cleanup()
    }
  })

  test("each further tap while ⌥ is held reaches one tab further back, most recent listed first", async () => {
    const view = await renderClientMarkup(<Workspace />)
    try {
      tapSwitchKey()
      tapSwitchKey()
      expect(optionLabels()).toEqual(["GammaCurrent", "Beta", "Alpha"])
      expect(highlightedLabel()).toStartWith("Alpha")

      releaseAlt()
      expect(focusedChat()).toBe("alpha")
      expect(document.querySelector("[data-tab-switcher]")).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test("recency follows real use, so a tab reopened earlier outranks one opened later", async () => {
    usePaneLayoutStore.getState().focusTab(buildTabId(chatTarget("alpha")))
    const view = await renderClientMarkup(<Workspace />)
    try {
      tapSwitchKey()
      releaseAlt()
      expect(focusedChat()).toBe("gamma")
    } finally {
      await view.cleanup()
    }
  })

  test("Escape closes the switcher and stays on the current tab", async () => {
    const view = await renderClientMarkup(<Workspace />)
    try {
      tapSwitchKey()
      key("keydown", { key: "Escape", altKey: true })
      releaseAlt()
      expect(focusedChat()).toBe("gamma")
      expect(document.querySelector("[data-tab-switcher]")).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test("the switch key never reaches a focused terminal, so the shell does not receive ESC-backtick", async () => {
    const view = await renderClientMarkup(<Workspace />)
    const terminal = document.createElement("textarea")
    document.body.appendChild(terminal)
    const reachedTerminal: string[] = []
    terminal.addEventListener("keydown", (event) => reachedTerminal.push(event.key))
    try {
      tapSwitchKey({}, terminal)
      tapSwitchKey({}, terminal)
      expect(reachedTerminal).toEqual([])
      expect(highlightedLabel()).toStartWith("Alpha")
    } finally {
      terminal.remove()
      await view.cleanup()
    }
  })

  test("⌘⌃ plus a digit jumps to that tab in the focused pane, and 9 always means the last one", async () => {
    const view = await renderClientMarkup(<Workspace />)
    try {
      key("keydown", { key: "1", code: "Digit1", metaKey: true, ctrlKey: true })
      expect(focusedChat()).toBe("alpha")

      key("keydown", { key: "9", code: "Digit9", metaKey: true, ctrlKey: true })
      expect(focusedChat()).toBe("gamma")
    } finally {
      await view.cleanup()
    }
  })
})
