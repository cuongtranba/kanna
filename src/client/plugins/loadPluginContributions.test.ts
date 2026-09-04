/**
 * The join between "what is installed" and "what the host renders". Both seams
 * are injected, so these cases drive the real collection logic with fakes.
 *
 * The command-center cases are the Phase 4 addition: a contributed `/` picker
 * entry has to survive the same containment rules as a sidebar item — collected
 * per plugin, and never lost because a DIFFERENT plugin threw.
 */
import { describe, expect, test } from "bun:test"
import { loadPluginContributions, type PluginListEntry } from "./loadPluginContributions"
import type { PluginModule } from "./evaluatePlugin"
import { isRecord } from "../../shared/errors"
import type { PluginContext } from "./contributionRegistry"

function listing(...entries: PluginListEntry[]) {
  return async () => entries
}

/** Narrows the loader's untyped context back to the shape it actually
 * passes, without an `as` cast: the loader hands over its own
 * `createPluginContext` result, so this is a check that cannot fail in
 * practice and a loud failure if the loader ever stops doing that. */
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

/** A plugin module whose default export runs `contribute` against the real
 * context object the loader builds. */
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
    // The registry is shared and written through as the plugin runs, so a throw
    // partway is contained to what came after it.
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
