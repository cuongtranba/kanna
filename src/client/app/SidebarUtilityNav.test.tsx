import { describe, expect, test } from "vite-plus/test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { useInboxStore } from "../stores/inboxStore"
import { SidebarUtilityNav, isUtilityRoute } from "./SidebarUtilityNav"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"

const NO_ITEMS: readonly PluginSidebarItem[] = []

function render(items: readonly PluginSidebarItem[] = NO_ITEMS, activeChatId: string | null = "chat-1") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SidebarUtilityNav
        activeChatId={activeChatId}
        onClose={() => {}}
        connectionStatus="connected"
        pluginItems={items}
      />
    </MemoryRouter>,
  )
}

describe("SidebarUtilityNav", () => {
  test("renders the three built-in destinations and the status row", () => {
    const html = render()
    expect(html).toContain("Workflows")
    expect(html).toContain("Cron jobs")
    expect(html).toContain("Settings")
    expect(html).toContain("Connected")
  })

  test("shows the unread count beside Inbox and nothing when everything is read", async () => {
    expect(render()).not.toContain("Inbox, ")
    useInboxStore.setState({ unreadCount: 120 })
    try {
      const { html, cleanup } = await renderClientMarkup(<MemoryRouter><SidebarUtilityNav
        activeChatId={null}
        onClose={() => {}}
        connectionStatus="connected"
        pluginItems={NO_ITEMS}
      /></MemoryRouter>)
      try {
        expect(html).toContain("Inbox, 120 unread")
        expect(html).toContain("99+")
      } finally {
        await cleanup()
      }
    } finally {
      useInboxStore.setState(useInboxStore.getInitialState())
    }
  })

  test("contributes nothing when no plugin supplied a sidebar item", () => {
    expect(render()).not.toContain("plugin-sidebar-items")
  })

  test("renders a plugin's sidebar item beside the built-ins", () => {
    const html = render([
      { pluginId: "hello", id: "main", title: "Hello", icon: "Blocks", surface: "main" },
    ])
    expect(html).toContain("plugin-sidebar-items")
    expect(html).toContain("Hello")
    expect(html).toContain("Workflows")
  })
})

describe("isUtilityRoute", () => {
  test("covers the home page and every utility section", () => {
    for (const path of ["/", "/settings/general", "/workflows/chat-1", "/cron", "/webhooks", "/inbox/thread-1"]) {
      expect(isUtilityRoute(path)).toBe(true)
    }
  })

  test("does not treat chat or board pages as utility pages", () => {
    expect(isUtilityRoute("/chat/chat-1")).toBe(false)
    expect(isUtilityRoute("/boards/project-1")).toBe(false)
  })
})
