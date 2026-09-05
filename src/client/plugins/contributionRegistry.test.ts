import { describe, expect, test } from "bun:test"
import { createPluginContext, createPluginContributionRegistry } from "./contributionRegistry"

describe("command-center contributions", () => {
  test("addCommandCenterItem records the item against the calling plugin", () => {
    const registry = createPluginContributionRegistry()
    createPluginContext("my-plugin", registry).addCommandCenterItem({
      name: "greet",
      description: "Say hello",
      prompt: "Say hello politely.",
    })

    expect(registry.getCommandCenterItems()).toEqual([
      { pluginId: "my-plugin", name: "greet", description: "Say hello", prompt: "Say hello politely." },
    ])
  })

  test("two plugins share one registry and stay attributed", () => {
    const registry = createPluginContributionRegistry()
    createPluginContext("alpha", registry).addCommandCenterItem({
      name: "greet",
      description: "",
      prompt: "alpha",
    })
    createPluginContext("beta", registry).addCommandCenterItem({
      name: "greet",
      description: "",
      prompt: "beta",
    })

    expect(registry.getCommandCenterItems().map((i) => i.pluginId)).toEqual(["alpha", "beta"])
  })

  test("the getter hands back a copy, so a caller cannot mutate the registry", () => {
    const registry = createPluginContributionRegistry()
    createPluginContext("alpha", registry).addCommandCenterItem({
      name: "greet",
      description: "",
      prompt: "alpha",
    })

    registry.getCommandCenterItems().length = 0

    expect(registry.getCommandCenterItems()).toHaveLength(1)
  })

  test("a plugin that contributes nothing to the picker leaves it empty", () => {
    const registry = createPluginContributionRegistry()
    createPluginContext("alpha", registry).addSidebarItem({
      id: "main",
      title: "Alpha",
      icon: "Blocks",
      surface: "main",
    })

    expect(registry.getCommandCenterItems()).toEqual([])
  })
})
