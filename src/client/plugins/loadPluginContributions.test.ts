import { describe, expect, test } from "bun:test"
import { loadPluginContributions, type PluginListEntry } from "./loadPluginContributions"
import type { PluginModule } from "./evaluatePlugin"
import { isRecord } from "../../shared/errors"
import type { PluginContext } from "./contributionRegistry"

function listing(...entries: PluginListEntry[]) {
  return async () => entries
}

function isPluginContext(value: unknown): value is PluginContext {
  return (
    isRecord(value) &&
    typeof value.addSurface === "function" &&
    typeof value.addSidebarItem === "function" &&
    typeof value.addCommandCenterItem === "function" &&
    typeof value.handle === "function"
  )
}

function asPluginContext(value: unknown): PluginContext {
  if (!isPluginContext(value)) throw new Error("loader did not pass a PluginContext")
  return value
}

function moduleThat(contribute: (plugin: PluginContext) => void): PluginModule {
  return { default: (context) => contribute(asPluginContext(context)) }
}

describe("loadPluginContributions", () => {
  test("collects command-center items with the contributing plugin's id", async () => {
    const loaded = await loadPluginContributions(
      listing({ id: "hello", enabled: true }),
      async () =>
        moduleThat((plugin) => {
          plugin.addCommandCenterItem({
            name: "greet",
            description: "Say hello",
            prompt: "Say hello politely.",
          })
        }),
    )

    expect(loaded.commandCenterItems).toEqual([
      { pluginId: "hello", name: "greet", description: "Say hello", prompt: "Say hello politely." },
    ])
    expect(loaded.failures).toEqual([])
  })

  test("a disabled plugin contributes nothing", async () => {
    const loaded = await loadPluginContributions(
      listing({ id: "hello", enabled: false }),
      async () =>
        moduleThat((plugin) => {
          plugin.addCommandCenterItem({ name: "greet", description: "", prompt: "hi" })
        }),
    )

    expect(loaded.commandCenterItems).toEqual([])
  })

  test("one plugin throwing does not lose another plugin's picker entry", async () => {
    const loaded = await loadPluginContributions(
      listing({ id: "bad", enabled: true }, { id: "good", enabled: true }),
      async (pluginId) =>
        moduleThat((plugin) => {
          if (pluginId === "bad") throw new Error("threw on register")
          plugin.addCommandCenterItem({ name: "greet", description: "", prompt: "hi" })
        }),
    )

    expect(loaded.commandCenterItems.map((i) => i.pluginId)).toEqual(["good"])
    expect(loaded.failures.map((f) => f.pluginId)).toEqual(["bad"])
  })

  test("items a plugin registered BEFORE it threw are kept", async () => {
    const loaded = await loadPluginContributions(
      listing({ id: "half", enabled: true }),
      async () =>
        moduleThat((plugin) => {
          plugin.addCommandCenterItem({ name: "first", description: "", prompt: "one" })
          throw new Error("threw after the first item")
        }),
    )

    expect(loaded.commandCenterItems.map((i) => i.name)).toEqual(["first"])
    expect(loaded.failures).toHaveLength(1)
  })

  test("no enabled plugins short-circuits to an empty result", async () => {
    const loaded = await loadPluginContributions(listing(), async () => {
      throw new Error("must not import anything")
    })

    expect(loaded.commandCenterItems).toEqual([])
    expect(loaded.sidebarItems).toEqual([])
    expect(loaded.panels).toEqual([])
  })
})
