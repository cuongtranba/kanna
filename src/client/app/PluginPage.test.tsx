import { afterEach, describe, expect, test } from "vite-plus/test"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { usePluginContributionsStore } from "../stores/pluginContributionsStore"
import { PluginPage } from "./PluginPage"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  usePluginContributionsStore.getState().clearContributions()
})

async function render(pluginId: string, surfaceId: string) {
  const rendered = await renderClientMarkup(<PluginPage pluginId={pluginId} surfaceId={surfaceId} />)
  cleanups.push(rendered.cleanup)
  return rendered.html
}

describe("PluginPage", () => {
  test("renders the matching surface full page", async () => {
    usePluginContributionsStore.getState().setContributions({
      sidebarItems: [],
      panels: [
        { pluginId: "hello", surfaceId: "main", Component: () => <span>hello-surface</span> },
        { pluginId: "other", surfaceId: "main", Component: () => <span>other-surface</span> },
      ],
      commandCenterItems: [],
    })

    const html = await render("hello", "main")

    expect(html).toContain("plugin-page:hello:main")
    expect(html).toContain("hello-surface")
    expect(html).not.toContain("other-surface")
  })

  test("explains when the plugin surface is not loaded", async () => {
    const html = await render("hello", "main")

    expect(html).toContain("plugin-page-missing:hello:main")
    expect(html).toContain("installed and enabled")
  })
})
