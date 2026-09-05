import { afterEach, describe, expect, test } from "bun:test"
import {
  selectPluginCommandCenterItems,
  usePluginContributionsStore,
} from "./pluginContributionsStore"

afterEach(() => {
  usePluginContributionsStore.getState().clearContributions()
})

describe("selectPluginCommandCenterItems", () => {
  test("returns a stable identity while nothing is contributed", () => {
    const first = selectPluginCommandCenterItems(usePluginContributionsStore.getState())
    const second = selectPluginCommandCenterItems(usePluginContributionsStore.getState())
    expect(first).toBe(second)
    expect(first).toHaveLength(0)
  })

  test("surfaces what was set", () => {
    usePluginContributionsStore.getState().setContributions({
      sidebarItems: [],
      panels: [],
      commandCenterItems: [
        { pluginId: "hello", name: "greet", description: "Say hello", prompt: "Say hello." },
      ],
    })

    expect(selectPluginCommandCenterItems(usePluginContributionsStore.getState())).toHaveLength(1)
  })

  test("a clear over an already-empty store is a no-op on state identity", () => {
    const before = usePluginContributionsStore.getState()
    usePluginContributionsStore.getState().clearContributions()
    expect(usePluginContributionsStore.getState()).toBe(before)
  })

  test("a clear after a contribution restores the empty identity", () => {
    usePluginContributionsStore.getState().setContributions({
      sidebarItems: [],
      panels: [],
      commandCenterItems: [
        { pluginId: "hello", name: "greet", description: "", prompt: "Say hello." },
      ],
    })
    usePluginContributionsStore.getState().clearContributions()

    const cleared = selectPluginCommandCenterItems(usePluginContributionsStore.getState())
    expect(cleared).toHaveLength(0)
    expect(cleared).toBe(selectPluginCommandCenterItems(usePluginContributionsStore.getState()))
  })
})
