import { afterEach, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TooltipProvider } from "../ui/tooltip"
import { createPane, createTab, type PaneLeaf } from "../../lib/paneTree"
import { DEFAULT_TAB_MIN_WIDTH } from "../../../shared/pane-tab-width"
import type { AppSettingsSnapshot } from "../../../shared/types"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useAppSettingsStore } from "../../stores/appSettingsStore"
import { SHELL_TOP_BAND_CLASS } from "../../lib/shellChrome"
import { PaneTabStrip } from "./PaneTabStrip"
import type { TabPresentationContext } from "./tabPresentation"

const chat = createTab({ kind: "chat", chatId: "c1" }, 0)
const changes = createTab({ kind: "changes" }, 0)
const t1 = createTab({ kind: "terminal", terminalId: "t1" }, 0)

function render(
  pane: PaneLeaf,
  isPaneFocused = true,
  width = 800,
  presentation: TabPresentationContext = {},
) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <PaneTabStrip
        pane={pane}
        isPaneFocused={isPaneFocused}
        width={width}
        presentation={{ terminalTitles: { t1: "Terminal A" }, ...presentation }}
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

  test("tints the active tab indicator by pane focus", () => {
    expect(render(createPane("p", [chat]), true)).toContain('data-tab-indicator="focused"')
    expect(render(createPane("p", [chat]), false)).toContain('data-tab-indicator="unfocused"')
  })

  test("the indicator uses a token colour, never a literal", () => {
    const html = render(createPane("p", [chat]), true)
    expect(html).toContain("bg-destructive")
    expect(html).not.toContain("#")
  })

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

  test("takes its height from the shared top-band token", () => {
    expect(render(createPane("p", [chat]))).toContain(SHELL_TOP_BAND_CLASS)
  })
})

describe("PaneTabStrip chat status", () => {
  const running: TabPresentationContext = {
    chatStatuses: { c1: { status: "running", unread: false, sessionState: "active" } },
  }

  test("a running chat tab carries the sidebar's amber dot", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).toContain('data-tab-status="warning"')
    expect(html).toContain("bg-warning")
  })

  test("the dot is a theme token, never a literal colour", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).not.toContain("#")
  })

  test("the status is spelled out for assistive tech", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).toContain("Running")
  })

  test("the PTY session badge rides along with the same drawn mark as the sidebar", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).toContain("data-tab-session-badge")
    expect(html).toContain("<svg")
    expect(html).not.toMatch(/[●◐○◌]/)
  })

  test("the dot survives a strip too cramped for labels", () => {
    const html = render(createPane("p", [chat, changes, t1]), true, 200, running)
    expect(html).not.toContain(">Chat<")
    expect(html).toContain('data-tab-status="warning"')
  })

  test("the session badge yields when there is no room for labels", () => {
    const html = render(createPane("p", [chat, changes, t1]), true, 200, running)
    expect(html).not.toContain("data-tab-session-badge")
  })

  test("a quiet chat keeps its plain icon", () => {
    const html = render(createPane("p", [chat]), true, 800, {
      chatStatuses: { c1: { status: "idle", unread: false } },
    })
    expect(html).not.toContain("data-tab-status")
    expect(html).toContain("svg")
  })
})

describe("PaneTabStrip split availability", () => {
  test("marks the split actions unavailable when the pane has one tab", () => {
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

describe("PaneTabStrip tab width preference", () => {
  const pane = createPane("p1", [chat, t1, changes])
  const SHARED_WIDTH = Math.round((260 - 52) / 3)

  afterEach(() => {
    useAppSettingsStore.setState({ settings: null })
  })

  function setTabMinWidth(tabMinWidth: number) {
    useAppSettingsStore.setState({
      settings: { panes: { tabMinWidth } } as unknown as AppSettingsSnapshot,
    })
  }

  async function renderStrip() {
    return renderClientMarkup(
      <TooltipProvider>
        <PaneTabStrip
          pane={pane}
          isPaneFocused
          width={260}
          presentation={{ terminalTitles: { t1: "Terminal A" } }}
          onSelectTab={() => undefined}
          onCloseTab={() => undefined}
          onSplit={() => undefined}
        />
      </TooltipProvider>,
    )
  }

  test("shrinks tabs toward the icon-only floor by default", async () => {
    setTabMinWidth(DEFAULT_TAB_MIN_WIDTH)
    const { html, cleanup } = await renderStrip()
    await cleanup()

    expect(html).toContain(`width: ${SHARED_WIDTH}px`)
    expect(html).not.toContain("overflow-x-auto")
  })

  test("holds tabs wider and scrolls the strip when the preference says so", async () => {
    setTabMinWidth(160)
    const { html, cleanup } = await renderStrip()
    await cleanup()

    expect(html).toContain("width: 160px")
    expect(html).toContain("overflow-x-auto")
  })

  test("falls back to the default before settings have hydrated", async () => {
    useAppSettingsStore.setState({ settings: null })
    const { html, cleanup } = await renderStrip()
    await cleanup()

    expect(html).toContain(`width: ${SHARED_WIDTH}px`)
  })
})
