/**
 * The hook is the ONLY thing that turns "plugins enabled" into contributions
 * the sidebar and chat footer can render. Before it existed every surface was
 * mounted but permanently empty, so these cases pin the wiring itself.
 */
import { describe, expect, test, afterEach, mock } from "bun:test"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { usePluginContributionsStore } from "../stores/pluginContributionsStore"
import { useAppSettingsStore } from "../stores/appSettingsStore"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  usePluginContributionsStore.getState().clearContributions()
  mock.restore()
})

function setPluginsEnabled(enabled: boolean): void {
  useAppSettingsStore.setState((state) => ({
    ...state,
    settings: { ...(state.settings ?? {}), plugins: { enabled } },
  }) as never)
}

async function mountWith(load: () => Promise<unknown>) {
  mock.module("./loadPluginContributions", () => ({
    loadPluginContributionsFromServer: load,
  }))
  const { usePluginContributions } = await import("./usePluginContributions")
  function Probe() {
    usePluginContributions()
    return null
  }
  const rendered = await renderForLoopCheck(<Probe />)
  cleanups.push(rendered.cleanup)
  // Let the load promise settle before asserting on the store.
  await Promise.resolve()
  await Promise.resolve()
  return rendered
}

describe("usePluginContributions", () => {
  test("loads contributions into the store when plugins are enabled", async () => {
    setPluginsEnabled(true)
    await mountWith(async () => ({
      sidebarItems: [{ pluginId: "hello", id: "main", title: "Hello", icon: "Blocks", surface: "main" }],
      panels: [],
      failures: [],
    }))

    expect(usePluginContributionsStore.getState().sidebarItems).toHaveLength(1)
  })

  test("clears the store and never loads while plugins are disabled", async () => {
    setPluginsEnabled(false)
    let called = 0
    await mountWith(async () => {
      called += 1
      return { sidebarItems: [], panels: [], failures: [] }
    })

    expect(called).toBe(0)
    expect(usePluginContributionsStore.getState().sidebarItems).toHaveLength(0)
  })

  test("a rejected load leaves the store empty instead of throwing", async () => {
    setPluginsEnabled(true)
    await mountWith(() => Promise.reject(new Error("network down")))

    expect(usePluginContributionsStore.getState().sidebarItems).toHaveLength(0)
  })

  // One bad plugin must not take the rest of the surface down — the same
  // containment `PluginBoundary` gives at render time, one step earlier.
  test("a per-plugin failure still commits the plugins that did load", async () => {
    setPluginsEnabled(true)
    await mountWith(async () => ({
      sidebarItems: [{ pluginId: "ok", id: "main", title: "OK", icon: "Blocks", surface: "main" }],
      panels: [],
      failures: [{ pluginId: "bad", message: "threw on register" }],
    }))

    expect(usePluginContributionsStore.getState().sidebarItems).toHaveLength(1)
  })
})
