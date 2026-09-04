/**
 * The slot is the seam that made the chat-footer panel reachable at all — the
 * panel component existed for a whole phase while mounted nowhere. These pin
 * the two things the seam must get right: it renders what the store holds, and
 * it costs nothing when there is nothing to show.
 *
 * `renderClientMarkup`, not `renderToStaticMarkup`: this component reads a
 * zustand store, and zustand v5 serves `getInitialState()` as the
 * `useSyncExternalStore` SERVER snapshot — so a static render never observes a
 * `setState` and the panel would look broken when it is not. See that helper's
 * own docstring.
 */
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
    // The default for every install: plugins are off, so the chat footer must
    // look exactly as it did before the feature existed.
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
