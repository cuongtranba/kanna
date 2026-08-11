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

  // Half of the shell's top-band contract: the strip must read its height from
  // the shared token, not a local literal, or it drifts out of line with the
  // sidebar header. The sidebar side is asserted in KannaSidebar.test.tsx.
  test("takes its height from the shared top-band token", () => {
    expect(render(createPane("p", [chat]))).toContain(SHELL_TOP_BAND_CLASS)
  })
})

/**
 * The tab strip shows the same chats the sidebar lists, so it must speak the
 * same status language. Before this, a chat mid-turn read "Running" on the left
 * and showed a plain, indistinguishable icon on its tab.
 */
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

  // Colour alone never communicates (DESIGN.md): the status has to reach a
  // screen reader too, and the tab's accessible name is where it lands.
  test("the status is spelled out for assistive tech", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).toContain("Running")
  })

  test("the PTY session badge rides along with the same glyph as the sidebar", () => {
    const html = render(createPane("p", [chat]), true, 800, running)
    expect(html).toContain("data-tab-session-badge")
    expect(html).toContain("●")
  })

  // The dot lives in the icon's slot precisely so a strip squeezed to
  // icon-only tabs does not lose the status it exists to show.
  test("the dot survives a strip too cramped for labels", () => {
    const html = render(createPane("p", [chat, changes, t1]), true, 200, running)
    expect(html).not.toContain(">Chat<")
    expect(html).toContain('data-tab-status="warning"')
  })

  // …while the secondary badge yields its width first.
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

/**
 * Store-driven, so these render through the client path — zustand serves
 * `getInitialState()` to a server render and a `setState` here would be
 * invisible (see renderClientMarkup).
 */
describe("PaneTabStrip tab width preference", () => {
  const pane = createPane("p1", [chat, t1, changes])
  /** 3 tabs sharing 260px less the 52px split actions. */
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
