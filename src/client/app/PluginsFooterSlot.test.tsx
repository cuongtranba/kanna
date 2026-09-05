import { describe, expect, test, afterEach } from "bun:test"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { PluginsFooterSlot } from "./PluginsFooterSlot"
import { usePluginContributionsStore } from "../stores/pluginContributionsStore"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  usePluginContributionsStore.getState().clearContributions()
})

async function render() {
  const rendered = await renderClientMarkup(<PluginsFooterSlot />)
  cleanups.push(rendered.cleanup)
  return rendered.html
}

describe("PluginsFooterSlot", () => {
  test("renders nothing when no plugin contributed a panel", async () => {
    expect(await render()).toBe("")
  })

  test("renders a contributed panel from the store", async () => {
    usePluginContributionsStore.getState().setContributions({
      sidebarItems: [],
      panels: [{ pluginId: "hello", surfaceId: "main", Component: () => <span>panel-body</span> }],
      commandCenterItems: [],
    })

    const html = await render()

    expect(html).toContain("Plugins")
    expect(html).toContain("panel-body")
  })
})
