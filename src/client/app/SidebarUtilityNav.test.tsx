/**
 * Extracted from `KannaSidebar.tsx` to make room for plugin-contributed nav
 * entries (that file sat exactly on its architecture-budget ceiling). These
 * pin both halves: the three built-in destinations still render, and a plugin
 * item appears beside them without disturbing them.
 */
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { SidebarUtilityNav } from "./SidebarUtilityNav"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"

const NO_ITEMS: readonly PluginSidebarItem[] = []

function render(items: readonly PluginSidebarItem[] = NO_ITEMS, activeChatId: string | null = "chat-1") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SidebarUtilityNav
        activeChatId={activeChatId}
        navigate={() => {}}
        onClose={() => {}}
        workflowsButtonClass=""
        isCronJobsActive={false}
        isSettingsActive={false}
        statusDotClass=""
        statusLabel="Connected"
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

  // Plugins are OFF by default, so the overwhelmingly common case is that this
  // block renders exactly as it did before the plugin system existed.
  test("contributes nothing when no plugin supplied a sidebar item", () => {
    expect(render()).not.toContain("plugin-sidebar-items")
  })

  test("renders a plugin's sidebar item beside the built-ins", () => {
    const html = render([
      { pluginId: "hello", id: "main", title: "Hello", icon: "Blocks", surface: "main" },
    ])
    expect(html).toContain("plugin-sidebar-items")
    expect(html).toContain("Hello")
    // The built-ins must survive the addition.
    expect(html).toContain("Workflows")
  })
})
